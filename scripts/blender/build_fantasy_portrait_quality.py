"""Build a preserved-source Elf or Demon portrait quality edition.

Run with Blender --background --factory-startup --disable-autoexec --python
this_file -- --race elf --edition elf-portrait-quality-v1. Artist native stays
at frames 1..25; the unsaved export copy has 0..1 second NLA clips.
"""
import argparse,hashlib,json,pathlib,runpy,sys,types
import bpy

ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/blender'))
from fantasy_portrait_quality import apply_elf_quality,apply_demon_quality,apply_faction_giant_quality
from roster_atlas import pack

parser=argparse.ArgumentParser()
parser.add_argument('--race',required=True,choices=['elf','demon'])
parser.add_argument('--edition',required=True)
parser.add_argument('--roles',nargs='+',default=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry'])
parser.add_argument('--atlas-size',type=int,default=4096)
parser.add_argument('--keep-siege',action='store_true')
parser.add_argument('--fit-floor',action='store_true',help='Measured root-height derivative; source rest/bone channels remain unchanged')
parser.add_argument('--refine-siege',action='store_true',help='Reuse approved faction head/anatomy on the living siege giant')
parser.add_argument('--resume-checkpoint',action='store_true',help='Continue preserved authoring without replacing finished outputs')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
if not args.edition.replace('-','').replace('_','').isalnum():raise ValueError('Edition must be a simple directory name')
source=ROOT/f'assets/source/battle/prototype-deadline-v2/reviewable-peris-{args.race}-army.blend'
out=ROOT/'assets/source/battle'/args.edition
if out.exists() and not args.resume_checkpoint:raise FileExistsError(str(out))
if args.resume_checkpoint and ((out/f'peris-{args.race}-army.blend').exists() or (out/f'exports/{args.race}-roster.glb').exists()):raise FileExistsError('Finished outputs cannot be replaced by checkpoint resume')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
source_hash=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(out/'authored-before-contact.blend') if args.resume_checkpoint else str(source),use_scripts=False)
master=bpy.data.collections['PERIS_EXPORT'];scene=bpy.context.scene
scene.frame_start=1;scene.frame_end=25;scene.render.fps=24
selected=set(args.roles)|({'ram','catapult'} if args.keep_siege else set())
keep={o for o in master.all_objects if o.type=='MESH' and o.get('peris_role') in selected}
arms={m.object for o in keep for m in o.modifiers if m.type=='ARMATURE'}
keep|=arms
if args.resume_checkpoint:
 new=bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS']
 records=json.loads(scene['peris_quality_authoring_records']);author_roles=json.loads(scene['peris_quality_author_roles'])
 if source_hash!=scene['peris_quality_source_hash'] or sorted(selected)!=json.loads(scene['peris_quality_selected_roles']):raise ValueError('Checkpoint source/roles do not match')
else:
 for obj in list(master.all_objects):
  if obj not in keep:bpy.data.objects.remove(obj,do_unlink=True)
 new=bpy.data.collections.new('FANTASY_PORTRAIT_NEW_COMPONENTS');scene.collection.children.link(new)
 records=[]
 author_roles=list(args.roles)+(['catapult'] if args.refine_siege and args.keep_siege and 'catapult' not in args.roles else [])
 for role in author_roles:
  candidates=[o for o in master.all_objects if o.type=='MESH' and o.get('peris_role')==role]
  body=next((o for o in candidates if 'mounted rider' in o.name),candidates[0])
  arm=next(m.object for m in body.modifiers if m.type=='ARMATURE')
  for rig in arms:
   rig.animation_data.action=None
   for track in rig.animation_data.nla_tracks:track.mute=not track.name.endswith('_idle')
  scene.frame_set(1);bpy.context.view_layer.update()
  operation=apply_elf_quality if args.race=='elf' else apply_demon_quality
  records.append(apply_faction_giant_quality(arm,role,body,new,args.race) if role=='catapult' else operation(arm,role,body,new))
  print('FANTASY_ROLE_AUTHORED',args.race,role,flush=True)
 for obj in new.all_objects:master.objects.link(obj)
 out.mkdir(parents=True)
 scene['peris_quality_authoring_records']=json.dumps(records)
 scene['peris_quality_selected_roles']=json.dumps(sorted(selected))
 scene['peris_quality_author_roles']=json.dumps(author_roles)
 scene['peris_quality_source_hash']=source_hash
 bpy.ops.file.pack_all()
 bpy.ops.wm.save_as_mainfile(filepath=str(out/'authored-before-contact.blend'),compress=True)

ground=[]
display_flags={o:o.hide_viewport for o in master.all_objects}
if args.fit_floor:
 from prototype_contact_floor import normalize_role_ground
 for role in sorted(selected):
  owned=[o for o in master.all_objects if o.type=='MESH' and o.get('peris_role')==role]
  role_arms={m.object for o in owned for m in o.modifiers if m.type=='ARMATURE'}
  roots=[a for a in role_arms if not a.parent]
  if len(roots)!=1:raise ValueError('Expected one unparented role root: '+role)
  # Evaluate only this role's meshes/rigs during its independent floor probe.
  # The support and all parented riders remain enabled; saved flags are restored
  # before any artist-native save. Other roles cannot affect these local skins.
  for obj in list(master.all_objects):obj.hide_viewport=obj not in role_arms and obj not in owned
  root_arm=roots[0];bones=[b.name for b in root_arm.data.bones if any(t in b.name.lower() for t in ['foot','toe','hoof','paw']) or b.name in ['Horse_Hand_L','Horse_Hand_R','Elephantidae_Hand_L','Elephantidae_Hand_R']]
  print('FANTASY_ROLE_CONTACT_START',args.race,role,root_arm.name,flush=True)
  if bones:
   rec=normalize_role_ground(master,role,root_arm,support_bones=bones,clearance=.025,sample_step=.5,body_anchor='hip' if 'hip' in root_arm.pose.bones else None,edition=args.edition)
  else:
   # Animal roots without semantically named foot joints: evaluated mount
   # geometry is support, excluding parented rider/tack meshes.
   root_objects={o for o in owned if any(m.type=='ARMATURE' and m.object==root_arm for m in o.modifiers)}
   rec=normalize_role_ground(master,role,root_arm,vertex_selector=lambda o,v:o in root_objects,clearance=.025,sample_step=.5,edition=args.edition)
   rec['supportSelection']='All visible geometry owned by mount/root rig; parented rider/tack excluded. Argmin is retained for independent semantic review.'
  ground.append(rec)
  print('FANTASY_ROLE_CONTACT_READY',args.race,role,rec['after']['minimumWorldZ'],flush=True)
for obj,flag in display_flags.items():obj.hide_viewport=flag
unpacked=out/f'editable-{args.race}-study.blend'
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(unpacked),compress=True)
used={slot.material for obj in new.all_objects if obj.type=='MESH' for slot in obj.material_slots if slot.material}
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in author_roles},PROFILE={'family':'spartan'})
pack(lib,args.race+'-portrait-quality',out/'textures',args.atlas_size)
for obj in new.objects:
 if obj.type!='MESH':continue
 obj['runtime_approved']=False;obj['peris_unit_finished']=False
 if obj.get('peris_atlas_partition','').startswith('licensed-'):
  credit=next(r['headCredit'] for r in records if r['role']==obj['peris_role'])
  obj['asset_author']=credit['author']+'; Peris credited head adaptation';obj['asset_license']=credit['license']
  obj['source_url']=credit['sourceUrl'];obj['source_file_sha256']=credit['sourceFileSha256'];obj['peris_component_credit']=json.dumps(credit)
 if obj.name not in master.objects:master.objects.link(obj)
native=out/f'peris-{args.race}-army.blend'
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
export_end=48 if args.fit_floor else 24
export_sampling=None
if args.fit_floor:
 # Reopen the immutable artist native before sampling. Only the unsaved clone
 # receives full TRS channels, preserving unkeyed source artist pose values.
 bpy.ops.wm.open_mainfile(filepath=str(native),use_scripts=False)
 from prototype_export_sampling import bake_saved_baseline_export
 export_sampling=bake_saved_baseline_export(bpy.data.collections['PERIS_EXPORT'],roles=sorted(selected),verify=True)
else:
 for arm in arms:
  for track in arm.animation_data.nla_tracks:
   track.mute=True
   for strip in track.strips:strip.frame_start=0;strip.frame_end=export_end
 scene.frame_start=0;scene.frame_end=export_end;scene.render.fps=export_end;scene.frame_set(0);bpy.context.view_layer.update()
raw=out/f'exports/{args.race}-roster.glb'
sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--animation-mode','NLA_TRACKS','--output',str(raw)]
runpy.run_path(str(ROOT/'scripts/blender/export_glb.py'),run_name='__main__')
record={'race':args.race,'edition':args.edition,'roles':sorted(selected),'portraitModifiedRoles':author_roles,'operations':records,'groundContact':ground,
 'source':str(source),'sourceSha256':source_hash,'sourceUnchanged':sha(source)==source_hash,'nativeArtistFrames':[1,25],
 'rawTimeSeconds':[0,1],'rawExportFPS':export_end,'rawExportFrames':[0,export_end],'exportSampling':export_sampling,'sharedEquivalentMaterials':len(used),'newComponentAtlasSize':args.atlas_size,
 'materialSharing':'Only identical original race-specific finishes and the same head-UV paint share shader identity. Existing source atlases remain untouched.',
 'runtimeApproved':False,'finishedUnitApproved':False,'files':{p.name:{'bytes':p.stat().st_size,'sha256':sha(p)} for p in [unpacked,native,raw]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
print('FANTASY_QUALITY_EDITION_READY',json.dumps(record['files']),flush=True)
