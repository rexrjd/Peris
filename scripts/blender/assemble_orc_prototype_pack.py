"""Append immutable reviewed Orc components without repacking their atlases.

Example: blender --background --factory-startup --disable-autoexec --python
this.py -- --out assets/source/battle/NEW_EDITION --source LABEL=NATIVE [...]
Native clips stay at artist frames 1..25; the unsaved export clone uses 0..24.
"""
import argparse,hashlib,json,pathlib,runpy,sys
import bpy

ROOT=pathlib.Path(__file__).resolve().parents[2]
ROLES=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult']
def digest(path):return {'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',required=True);parser.add_argument('--source',action='append',required=True)
 args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 out=(ROOT/args.out).resolve()
 if (ROOT/'assets/source/battle').resolve() not in out.parents:raise ValueError('New local native edition must remain under assets/source/battle')
 if out.exists():raise FileExistsError('Preserve existing editions: '+str(out))
 specs=[]
 for entry in args.source:
  label,text=entry.split('=',1);path=(ROOT/text).resolve()
  if not path.is_file() or path.suffix.lower()!='.blend':raise ValueError('Explicit saved native required: '+str(path))
  specs.append((label,path,digest(path)))
 bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene
 master=bpy.data.collections.new('PERIS_EXPORT');scene.collection.children.link(master)
 source_records=[];ownership={};all_arms=[]
 for label,path,fingerprint in specs:
  with bpy.data.libraries.load(str(path),link=False) as (data_from,data_to):
   if 'PERIS_EXPORT' not in data_from.collections:raise ValueError('Missing explicit source export collection: '+str(path))
   data_to.collections=['PERIS_EXPORT']
  child=data_to.collections[0];child.name='Orc immutable component '+label;master.children.link(child)
  meshes=[o for o in child.all_objects if o.type=='MESH'];arms=[o for o in child.all_objects if o.type=='ARMATURE']
  roles=sorted({o.get('peris_role') for o in meshes})
  if not meshes or any(role not in ROLES for role in roles):raise ValueError('Unknown or missing source role ownership: '+label)
  for role in roles:
   if role in ownership:raise ValueError('Role supplied twice: '+role)
   ownership[role]=label
  for o in meshes:
   if not any(m.type=='ARMATURE' and m.object in arms for m in o.modifiers):raise ValueError('Draw mesh lost its source skin: '+o.name)
   license_id=o.get('asset_license')
   if license_id not in ['CC-BY-SA-3.0','CC-BY-4.0']:raise ValueError('Unrecorded component license: '+o.name)
   if license_id=='CC-BY-4.0' and not o.get('source_file_sha256'):raise ValueError('Adapted head source hash missing: '+o.name)
   o['runtime_approved']=False;o['peris_unit_finished']=False;o['peris_source_native_component']=label;o['peris_source_native_sha256']=fingerprint['sha256']
  for arm in arms:
   if not arm.animation_data or len(arm.animation_data.nla_tracks)!=3:raise ValueError('Each source rig must retain exactly three role tracks: '+arm.name)
   arm.animation_data.action=None
   for track in arm.animation_data.nla_tracks:
    if track.name.rsplit('_',1)[0] not in roles:raise ValueError('Track/role mismatch: '+track.name)
    if len(track.strips)!=1:raise ValueError('Expected one explicit strip: '+track.name)
    strip=track.strips[0]
    if abs(strip.frame_start-1)>1e-5 or abs(strip.frame_end-25)>1e-5:raise ValueError('Native artist timing changed: '+track.name)
    track.mute=not track.name.endswith('_idle')
   all_arms.append(arm)
  source_records.append({'label':label,'native':str(path.relative_to(ROOT)),'fingerprint':fingerprint,'roles':roles,'meshCount':len(meshes),'rigCount':len(arms),
                         'components':[{'name':o.name,'role':o['peris_role'],'license':o['asset_license'],'author':o.get('asset_author'),'sourceUrl':o.get('source_url'),'sourceHash':o.get('source_file_sha256'),'componentCredit':o.get('peris_component_credit')} for o in meshes]})
 if set(ownership)!=set(ROLES):raise ValueError('Incomplete nine-role pack: '+str(ownership))
 scene.render.fps=24;scene.frame_start=1;scene.frame_end=25;scene.frame_set(1);bpy.context.view_layer.update()
 record={'edition':out.name,'faction':'orc','roles':ROLES,'sourceComponents':source_records,'atlasOperation':'Existing per-component packed atlases retained; no global material repack or head texture resampling',
         'nativeArtistFrames':[1,25],'exportTimeSeconds':[0,1],'runtimeApproved':False,'finishedUnitApproved':False,
         'visualApproval':'User accepted Axe V19 and three infantry prototype appearances including the bounded Bowman contact fix. Cavalry refinement and siege appearance remain separate; all technical/runtime approvals remain false'}
 scene['peris_source_credits']=json.dumps(source_records,ensure_ascii=False);scene['peris_complete_orc_prototype_pack']=json.dumps(record,ensure_ascii=False)
 out.mkdir(parents=True);bpy.ops.file.pack_all();native=out/'peris-orc-army.blend';bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
 # Export only from the unsaved normalized clone. Saved native and inputs remain intact.
 for arm in all_arms:
  for track in arm.animation_data.nla_tracks:
   track.mute=True
   for strip in track.strips:strip.frame_start=0;strip.frame_end=24
 scene.frame_start=0;scene.frame_end=24;scene.frame_set(0);bpy.context.view_layer.update()
 raw=out/'exports/orc-roster.glb';sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--animation-mode','NLA_TRACKS','--output',str(raw)]
 runpy.run_path(str(ROOT/'scripts/blender/export_glb.py'),run_name='__main__')
 record['native']=digest(native);record['raw']=digest(raw)
 record['sourceFilesUnchanged']=all(digest(path)==fingerprint for _,path,fingerprint in specs)
 if not record['sourceFilesUnchanged']:raise ValueError('Source native changed during append')
 (out/'provenance.json').write_text(json.dumps(record,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
 print('ORC_COMPLETE_PROTOTYPE_PACK',json.dumps({'out':str(out),'roles':ROLES,'meshCount':sum(r['meshCount'] for r in source_records),'rigCount':len(all_arms),'native':record['native'],'raw':record['raw'],'sourcesUnchanged':True}),flush=True)

if __name__=='__main__':main()
