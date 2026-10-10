"""New native derivative with bounded six-bit relief/roughness texture storage.

Only the new detail pass's non-color images change. Relief maps are sized for
the 512px runtime, then rounded to six bits. Geometry, albedo, UVs,
skeletons and animation remain unchanged.
"""
import bpy,numpy as np,argparse,sys,pathlib,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=pathlib.Path(a.source).resolve();out=pathlib.Path(a.out).resolve()
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();oldsha=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);records=[]
for im in bpy.data.images:
 if im.colorspace_settings.name!='Non-Color' or not any(t in im.name for t in ['demon-refined-siege-and-rhino','Rhino charcoal cracked','Demon siege mottled']):continue
 original_size=list(im.size)
 if max(im.size)>512:
  ratio=512/max(im.size);im.scale(max(1,round(im.size[0]*ratio)),max(1,round(im.size[1]*ratio)))
 w,h=im.size;pixels=np.empty(w*h*4,np.float32);im.pixels.foreach_get(pixels);pixels=pixels.reshape(h,w,4);before=pixels.copy();pixels[:,:,:3]=np.round(pixels[:,:,:3]*63)/63;im.pixels.foreach_set(pixels.ravel());im.update();im.pack();records.append({'image':im.name,'originalSize':original_size,'runtimeSize':[w,h],'maximumDifferenceAfterResize':float(np.abs(pixels-before).max()),'alphaUnchangedByQuantization':True,'levels':64})
if not records:raise ValueError('No explicit new authored maps found')
out.parent.mkdir(parents=True);bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True)
if sha(source)!=oldsha:raise ValueError('Source native changed')
(out.parent/'surface-storage.json').write_text(json.dumps({'source':str(source),'sourceSha256':oldsha,'sourceUnchanged':True,'geometryAlbedoUVRigActionsUnchanged':True,'maps':records,'nativeSha256':sha(out),'finishedUnitApproved':False},indent=2)+'\n');print('AUTHORED_SURFACE_STORAGE_READY',len(records),flush=True)
