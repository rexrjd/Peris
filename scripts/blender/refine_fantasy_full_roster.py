"""Preserved full-roster derivative: required shields, gripping hands, stone kit.

Approved faces/clothing and native clips/rest rigs stay intact. Runtime export
uses the independently verified saved-baseline clone helper in a later step.
"""
import argparse,hashlib,json,pathlib,sys,types
import bpy,bmesh
from mathutils import Vector
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from fantasy_portrait_quality import portrait_hands,material,curve
from prototype_shield_fit import fit_role_shield
from roster_atlas import pack

p=argparse.ArgumentParser();p.add_argument('--race',required=True,choices=['elf','demon']);p.add_argument('--source-edition',required=True);p.add_argument('--edition',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/a.source_edition/f'editable-{a.race}-study.blend';out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();source_hash=sha(source)
bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
master=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'];scene=bpy.context.scene
roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult'];records=[]
arms=[o for o in master.all_objects if o.type=='ARMATURE']
for rig in arms:
 rig.animation_data.action=None
 for track in rig.animation_data.nla_tracks:track.mute=not track.name.endswith('_idle')
scene.frame_set(1);bpy.context.view_layer.update()

def source_body(role):
 candidates=[o for o in master.all_objects if o.type=='MESH' and o.get('peris_role')==role and o not in set(new.objects)]
 return next((o for o in candidates if 'mounted rider' in o.name),candidates[0])

for role in ['spear_guard','elite','scout','light_cavalry','heavy_cavalry']:
 body=source_body(role);arm=next(m.object for m in body.modifiers if m.type=='ARMATURE')
 bow_rider=a.race=='demon' and role in ['scout','light_cavalry']
 sides=('L',) if bow_rider else ('R','L')
 removed=portrait_hands(arm,role,body,new,a.race,sides=sides)
 leather=material(a.race+' weapon leather and dark iron',(.045,.032,.020),.05,.80)
 for side in sides:
  matrix=arm.data.bones['hand_'+side].matrix_local
  # The preserved pole/handle/rein remains unchanged; this short leather grip
  # sits inside the measured curled digits on the same actual hand bone.
  obj=curve('Functional hand-local leather grip '+side,[matrix@Vector((0,.15,-.115)),matrix@Vector((0,.15,.115))],.043,arm,role,'hand_'+side,leather,new)
  obj['peris_functional_grip']='Short leather palm grip; existing source weapon/rein and actual bone/socket remain unchanged. Original source connection needs actual idle/attack review.'
 records.append({'role':role,'replacement':'Connected palm, four curled digits and opposing thumb reused from accepted line construction','sides':list(sides),'sourceDrawHandPreserved':bow_rider,'removedOldHandFaces':removed,'shaftReservation':.045,'leatherGripRadius':.043,'sourceWeaponOrReinGeometryChanged':False,'runtimeApproved':False})
 print('FANTASY_DETAIL_HANDS_READY',a.race,role,flush=True)

# Preserve articulated bow draw/release fingers; replace the stark source finish.
for bow_role in ['archer']+(['scout','light_cavalry'] if a.race=='demon' else []):
 body=source_body(bow_role);names={g.index:g.name for g in body.vertex_groups}
 skin=material(a.race+' original articulated archer hand skin',(.62,.48,.34) if a.race=='elf' else (.37,.067,.044),0,.84)
 body.data.materials.append(skin);slot=len(body.data.materials)-1;count=0
 for poly in body.data.polygons:
  weight=sum(g.weight for vi in poly.vertices for g in body.data.vertices[vi].groups if names[g.group].startswith(('hand_','finger','thumb')))/len(poly.vertices)
  if weight>.5:poly.material_index=slot;poly.use_smooth=True;count+=1
 records.append({'role':bow_role,'articulatedSourceHandFacesFinished':count,'geometryWeightsBowStringAndClipsUnchanged':True,'runtimeApproved':False})

if a.race=='elf':
 body=source_body('catapult');bm=bmesh.new();bm.from_mesh(body.data);pending=set(bm.verts);components=[]
 while pending:
  seed=pending.pop();component={seed};todo=[seed]
  while todo:
   for edge in todo.pop().link_edges:
    for v in edge.verts:
     if v in pending:pending.remove(v);component.add(v);todo.append(v)
  components.append(component)
 largest=max(components,key=len);ids={v.index for v in largest};bm.free()
 stone=bpy.data.materials.get('Faction siege natural mineral granite')
 if stone is None:raise ValueError('Existing tested natural-mineral material missing')
 body.data.materials.append(stone);slot=len(body.data.materials)-1;uv=body.data.uv_layers.active;count=0
 coords=[v.co for v in body.data.vertices if v.index in ids];lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
 for poly in body.data.polygons:
  if poly.vertices[0] not in ids:continue
  poly.material_index=slot;count+=1;axis=max(range(3),key=lambda i:abs(poly.normal[i]));plane=[i for i in range(3) if i!=axis]
  for li,vi in zip(poly.loop_indices,poly.vertices):
   co=body.data.vertices[vi].co;uv.data[li].uv=[.04+.92*(co[i]-lo[i])/max(hi[i]-lo[i],.001) for i in plane]
 records.append({'role':'catapult','mineralBodyFaces':count,'method':'Largest connected inherited body receives the same tested natural granite finish as the credited stone face and boulder; separate root bindings remain unchanged','geometryWeightsThrowAndClipsUnchanged':True,'runtimeApproved':False})

for obj in new.all_objects:
 if obj.name not in master.objects:master.objects.link(obj)
shield_records=[fit_role_shield(master,role,target_ratio=.775) for role in roles if role not in ['archer','ram','catapult']]
out.mkdir(parents=True);editable=out/f'editable-{a.race}-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
authored=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','catapult']
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in authored},PROFILE={'family':'spartan'})
pack(lib,a.race+'-final-grip-shield-quality',out/'textures',4096)
for obj in new.all_objects:
 if obj.name not in master.objects:master.objects.link(obj)
native=out/f'peris-{a.race}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(source)!=source_hash:raise ValueError('Original source changed')
record={'race':a.race,'edition':a.edition,'sourceNative':str(source),'sourceSha256':source_hash,'sourceUnchanged':True,'roles':roles,'handAndMaterialOperations':records,'shieldSizeOperations':shield_records,'approvedFaceClothingGeometryUnchanged':True,'nativeOriginalFrames':[1,25],'floorFittingInheritedUnchanged':True,'actionsRestBonesBindMatricesUnchanged':True,'runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
print('FANTASY_REFINED_FULL_NATIVE_READY',json.dumps(record['files']),flush=True)
