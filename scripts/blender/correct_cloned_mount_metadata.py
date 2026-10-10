"""Immutable native derivative: reconcile a copied rig's semantic role metadata.

Mesh geometry, rest matrices, weights, actions and textures stay unchanged.
Only copied metadata can change; every owned mesh must agree on its role.
"""
import argparse,bpy,hashlib,json,pathlib,sys
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=pathlib.Path(a.source).resolve();out=pathlib.Path(a.out).resolve()
if out.exists():raise FileExistsError(out)
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest();source_sha=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);c=bpy.data.collections['PERIS_EXPORT'];changes=[]
for arm in [o for o in c.all_objects if o.type=='ARMATURE']:
 roles={o.get('peris_role') for o in c.all_objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)}
 if len(roles)!=1 or None in roles:raise ValueError('Ambiguous mesh ownership: '+arm.name)
 role=next(iter(roles))
 if arm.get('peris_role')!=role:
  changes.append({'rig':arm.name,'old':arm.get('peris_role'),'new':role});arm['peris_role']=role
out.parent.mkdir(parents=True);bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True)
if sha(source)!=source_sha:raise ValueError('Source changed')
(out.parent/'metadata-reconciliation.json').write_text(json.dumps({'sourceNative':str(source),'sourceSha256':source_sha,'sourceUnchanged':True,'geometryRestWeightsActionsTexturesUnchanged':True,'changes':changes,'nativeSha256':sha(out),'finishedUnitApproved':False},indent=2)+'\n')
print('MOUNT_METADATA_READY',json.dumps(changes),flush=True)
