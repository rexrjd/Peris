"""Export an immutable artist native with exact saved-baseline halfstep poses.

The native is opened with scripts disabled and never saved. New raw/report paths
are required so earlier exports and their provenance remain reviewable.
"""
import argparse,hashlib,json,pathlib,runpy,sys
import bpy
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts/blender'))
from prototype_export_sampling import bake_saved_baseline_export,DEFAULT_ROLES
from prototype_glb_names import namespace_exported_glb_nodes
p=argparse.ArgumentParser();p.add_argument('--native',required=True);p.add_argument('--out',required=True);p.add_argument('--report',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);native=pathlib.Path(a.native).resolve();out=pathlib.Path(a.out).resolve();report=pathlib.Path(a.report).resolve()
source_names_out=out.with_name(out.stem+'-source-names'+out.suffix)
if out.exists() or report.exists() or source_names_out.exists():raise FileExistsError('New immutable export and report paths are required')
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();source_hash=sha(native)
bpy.ops.wm.open_mainfile(filepath=str(native),use_scripts=False)
record=bake_saved_baseline_export(bpy.data.collections['PERIS_EXPORT'],roles=DEFAULT_ROLES,verify=True)
out.parent.mkdir(parents=True,exist_ok=True)
sys.argv=['export_glb.py','--','--collection','PERIS_EXPORT','--animation-mode','NLA_TRACKS','--output',str(source_names_out)]
runpy.run_path(str(ROOT/'scripts/blender/export_glb.py'),run_name='__main__')
record['runtimeNodeNamespace']=namespace_exported_glb_nodes(source_names_out,out)
if sha(native)!=source_hash:raise ValueError('Immutable artist native changed')
record.update({'sourceNative':str(native),'sourceNativeSha256':source_hash,'sourceNativeUnchanged':True,'raw':str(out),'rawBytes':out.stat().st_size,'rawSha256':sha(out),'runtimeApproved':False,'finishedUnitApproved':False})
report.parent.mkdir(parents=True,exist_ok=True);report.write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
print('FANTASY_EXACT_BASELINE_EXPORT_READY',out.stat().st_size,record['rawSha256'],flush=True)
