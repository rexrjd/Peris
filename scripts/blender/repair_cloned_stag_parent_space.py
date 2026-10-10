"""Restore a copied stag mesh's source parent space in a new native edition.

Object.copy/parent replacement left the copied body's parent-space transform
different from the donor. Preserve topology, weights, bind/rest matrices and
motion; restore the donor's local mesh transform, then refit root clearance.
"""
import argparse,bpy,hashlib,json,pathlib,sys
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from prototype_contact_floor import normalize_role_ground
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True);p.add_argument('--edition',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=pathlib.Path(a.source).resolve();out=pathlib.Path(a.out).resolve()
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();oldsha=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);c=bpy.data.collections['PERIS_EXPORT']
root=bpy.data.objects['light_cavalry great stag anatomy rig'];donor=bpy.data.objects['heavy_cavalry armored elk anatomy rig']
def sample():
 for arm in [o for o in c.all_objects if o.type=='ARMATURE']:
  arm.animation_data.action=None
  for t in arm.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
 bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
sample();changes=[]
for mesh in [o for o in c.all_objects if o.type=='MESH' and o.name.startswith('light_cavalry great stag heavy_cavalry')]:
 original=bpy.data.objects[mesh.name.removeprefix('light_cavalry great stag ')]
 if original.parent!=donor or mesh.parent!=root:raise ValueError('Unexpected donor or copy hierarchy')
 before=[list(row) for row in mesh.matrix_parent_inverse]
 mesh.matrix_parent_inverse=original.matrix_parent_inverse.copy();mesh.matrix_basis=original.matrix_basis.copy()
 changes.append({'mesh':mesh.name,'sourceMesh':original.name,'parentInverseBefore':before,'parentInverseAfter':[list(row) for row in mesh.matrix_parent_inverse]})
if len(changes)!=2:raise ValueError('Expected body and source saddle clone')
sample();support=[b.name for b in root.data.bones if any(token in b.name.lower() for token in ['hoof','foot','hand','finger0','toe0']) and 'ik' not in b.name.lower() and not b.name.startswith('prop')];flags={o:o.hide_viewport for o in c.all_objects}
for o in c.all_objects:o.hide_viewport=o.get('peris_role')!='light_cavalry'
floor=normalize_role_ground(c,'light_cavalry',root,support_bones=support,clearance=.025,sample_step=.5,allow_lowering=True,edition=a.edition)
for o,flag in flags.items():o.hide_viewport=flag
sample();rider=next(o for o in c.all_objects if o.type=='ARMATURE' and o.get('peris_role')=='light_cavalry' and 'hip' in o.data.bones);seat=root.matrix_world@root.pose.bones['peris_seated_rider'].head+Vector((0,0,.02))
actual=rider.matrix_world@rider.pose.bones['hip'].head
# The authored saddle target sits 0.02 above its preserved back socket.
error=(actual-seat).length
if error>.005:raise ValueError('Corrected mount missed seated rider '+str(error))
for o in c.all_objects:
 if o.get('peris_role')=='light_cavalry' and 'peris_seat_hip_world' in o:
  o['peris_seat_hip_world']=list(actual);o['peris_seat_target_world']=list(seat);o['peris_seat_fit_error']=error
out.parent.mkdir(parents=True);bpy.ops.wm.save_as_mainfile(filepath=str(out),compress=True)
if sha(source)!=oldsha:raise ValueError('Immutable native changed')
(out.parent/'parent-space.json').write_text(json.dumps({'sourceNative':str(source),'sourceSha256':oldsha,'sourceUnchanged':True,'geometryTopologyWeightsRestAndOriginalMotionUnchanged':True,'changes':changes,'floorAudit':floor,'seatedRiderError':error,'nativeSha256':sha(out),'finishedUnitApproved':False},indent=2)+'\n')
print('STAG_PARENT_SPACE_READY',len(changes),error,flush=True)
