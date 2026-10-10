"""Run a frozen human-kit edition without changing the shared roster builder."""
import pathlib, sys, hashlib, json, types
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
builder=pathlib.Path(__file__).with_name('build_faction_rosters.py')
text=builder.read_text(encoding='utf-8')
needle="    if PROFILES[faction].get('skin'):\n"
replacement="    if faction in ['roman','spartan','persian','egyptian']:\n        import roster_human_equipment\n        geometry={'cone':cone,'cube':cube,'ellipsoid':ellipsoid,'curved':curved,'mesh_prop':mesh_prop}\n        roster_human_equipment.apply(lib,arm,role,faction,mats,geometry,PROFILES[faction])\n        return\n"+needle
if text.count(needle)!=1:raise RuntimeError('Shared builder human hook changed; review integration')
text=text.replace(needle,replacement,1)
profile_hook="ACTORS={\n"
if text.count(profile_hook)!=1:raise RuntimeError('Shared builder profile hook changed')
text=text.replace(profile_hook,"import roster_human_equipment\nfor _faction,_skin in roster_human_equipment.SKIN.items():PROFILES[_faction]['skin']=_skin\n\n"+profile_hook,1)
timing_hook="    shifted=[]\n    if faction=='orc':\n"
if text.count(timing_hook)!=1:raise RuntimeError('Shared builder export timing hook changed')
text=text.replace(timing_hook,"    shifted=[]\n    if faction in ['orc','roman','spartan','persian','egyptian']:\n",1)
editable_hook="    roster_atlas.pack(lib,faction,OUT/'textures'/faction)\n"
if text.count(editable_hook)!=1:raise RuntimeError('Shared builder atlas hook changed')
text=text.replace(editable_hook,"    bpy.context.scene.render.fps=24\n    for _arm in lib.rigs:\n        if _arm.animation_data:\n            _arm.animation_data.action=None\n            for _track in _arm.animation_data.nla_tracks:_track.mute=not _track.name.endswith('_idle')\n    bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1)\n    OUT.mkdir(parents=True,exist_ok=True)\n    bpy.ops.file.pack_all()\n    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/('editable-'+faction+'-study.blend')),compress=True)\n"+editable_hook,1)
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
edition=args[args.index('--edition')+1] if '--edition' in args else 'human-portrait-v1'
if not edition.startswith('human-portrait-'):raise ValueError('Use a separate human portrait edition')
snapshot=ROOT/'assets/source/battle'/edition/'pipeline-snapshot'
if snapshot.exists():raise FileExistsError('Preserve existing human source editions')
snapshot.mkdir(parents=True)
modules=['build_faction_rosters.py','roster_human_equipment.py','human_quality_details.py','roster_race_equipment.py','reference_roster_lib.py','roster_atlas.py','roster_anatomy.py','orc_portrait_hands.py','prototype_shield_fit.py']
report={}
for name in modules:
    data=builder.with_name(name).read_bytes();(snapshot/name).write_bytes(data);report[name]=hashlib.sha256(data).hexdigest()
(snapshot/'snapshot.json').write_text(json.dumps(report,indent=2)+'\n')
(snapshot/'human-builder-integrated.py').write_text(text,encoding='utf-8')
# Frozen helpers keep their original module paths so repository-relative caches
# resolve correctly. Their executed bytes come only from this edition snapshot.
for name in ['reference_roster_lib.py','roster_atlas.py','roster_anatomy.py','roster_race_equipment.py','human_quality_details.py','roster_human_equipment.py']:
    module=types.ModuleType(pathlib.Path(name).stem);module.__file__=str(builder.with_name(name))
    sys.modules[module.__name__]=module
    exec(compile((snapshot/name).read_text(encoding='utf-8'),module.__file__,'exec'),module.__dict__)
exec(compile(text,str(builder),'exec'),{'__file__':str(builder),'__name__':'__main__'})
