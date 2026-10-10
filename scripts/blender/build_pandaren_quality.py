"""Build an immutable Pandaren quality edition from the preserved nine-role source."""
import argparse,pathlib,sys,json,hashlib,types,runpy,bpy
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
import pandaren_quality,roster_atlas
from roster_fantasy_prototype_repairs import _rig_hash
p=argparse.ArgumentParser();p.add_argument('--edition',required=True);p.add_argument('--atlas-size',type=int,default=2048);args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
if not args.edition.startswith('pandaren-quality-roster-v') or '/' in args.edition or '\\' in args.edition:raise ValueError('Expected a named immutable Pandaren roster edition')
SOURCE=ROOT/'assets/source/battle/prototype-deadline-v2/reviewable-peris-pandaren-army.blend';OUT=ROOT/'assets/source/battle'/args.edition
if OUT.exists():raise FileExistsError(str(OUT))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();source_hash=sha(SOURCE)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False);collection=bpy.data.collections['PERIS_EXPORT']
arms=[o for o in collection.all_objects if o.type=='ARMATURE'];before={a.name:_rig_hash(a) for a in arms};records=[]
for role in ['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','catapult','ram']:
    body=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role and any(m.type=='ARMATURE' and (m.object.data.bones.get('hip') or role=='ram') for m in o.modifiers))
    arm=next(m.object for m in body.modifiers if m.type=='ARMATURE')
    record,parts=pandaren_quality.ram_details(collection,arm) if role=='ram' else pandaren_quality.apply(collection,arm,role);records.append(record)
    print('PANDA_ROLE_BUILT',role,len(parts),flush=True)
after={a.name:_rig_hash(a) for a in arms}
if before!=after:raise ValueError('Existing source rigs, bind bones or action curves changed')
for a in arms:
    for t in a.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(0);bpy.context.scene.frame_set(1);bpy.context.view_layer.update();OUT.mkdir(parents=True);bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'unpacked-pandaren-study.blend'),compress=True)
detail=bpy.data.collections.new('PERIS_PANDA_NEW_DETAIL');bpy.context.scene.collection.children.link(detail)
for obj in list(collection.objects):
    if obj.get('peris_atlas_partition')=='original-bear-detail':collection.objects.unlink(obj);detail.objects.link(obj)
lib=types.SimpleNamespace(collection=detail,groups={},PROFILE={'family':'egyptian'});roster_atlas.pack(lib,'pandaren',OUT/'textures/detail',size=args.atlas_size)
for obj in list(detail.objects):detail.objects.unlink(obj);collection.objects.link(obj)
bpy.data.collections.remove(detail);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'peris-pandaren-army.blend'),compress=True)
for a in arms:
    for t in a.animation_data.nla_tracks:
        t.mute=True
        for s in t.strips:s.frame_start=0;s.frame_end=24
bpy.context.scene.frame_start=0;bpy.context.scene.frame_end=24;bpy.context.scene.frame_set(0)
sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--animation-mode','NLA_TRACKS','--output',str(OUT/'exports/pandaren-roster.glb')];runpy.run_path(str(ROOT/'scripts/blender/export_glb.py'),run_name='__main__')
report={'edition':args.edition,'roles':records,'rigHashesBefore':before,'rigHashesAfter':after,'sourceNative':str(SOURCE),'sourceSha256Before':source_hash,'sourceSha256After':sha(SOURCE),'allNineRoles':len(records)==9,'files':{n:{'bytes':(OUT/n).stat().st_size,'sha256':sha(OUT/n)} for n in ['unpacked-pandaren-study.blend','peris-pandaren-army.blend','exports/pandaren-roster.glb']},'runtimeApproved':False,'finishedUnitApproved':False}
(OUT/'provenance.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print('PANDA_ROSTER_READY',json.dumps(report['files']),flush=True)
