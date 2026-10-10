"""Bounded original polearm, mounted spear and jade kit on saved source rigs."""
import bpy,bmesh,math
from mathutils import Vector,Matrix
from pandaren_quality import Gear,material
from prototype_bound_shield_resize import clone_field_part
from prototype_contact_floor import _snapshot,_pose,_restore

def _rig(collection,role):return next(m.object for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role for m in o.modifiers if m.type=='ARMATURE' and 'hand_R' in m.object.data.bones)

def _group_ids(obj,name):
 g=obj.vertex_groups.get(name);return [v.index for v in obj.data.vertices if g and any(w.group==g.index and w.weight>.95 for w in v.groups)]

def add_kit(collection,detail):
 jade=material('Panda final jade armor grain',(.045,.19,.125),kind='metal',metal=.55);gold=material('Panda final worn bound gold bronze',(.37,.245,.09),kind='metal',metal=.68);steel=material('Panda final hammered guandao steel',(.28,.31,.32),kind='metal',metal=.72);red=material('Panda final folded crimson kit cloth',(.28,.047,.029),kind='cloth');leather=material('Panda final dark actual grip leather',(.040,.027,.019),kind='leather');rows=[];arms,saved,frame=_snapshot(collection)
 # The mounted lancer now carries a genuine original source spear in its right
 # closed palm. Source hand sockets and all source clips remain untouched.
 role='light_cavalry';target=_rig(collection,role);source_arm=_rig(collection,'spear_guard');source=next(o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')=='spear_guard' and o.parent==source_arm and len(_group_ids(o,'hand_R'))>40 and not o.get('peris_atlas_partition')=='original-connected-bear-grip');ids=_group_ids(source,'hand_R');sourceHand=source_arm.data.bones['hand_R'].matrix_local;targetHand=target.data.bones['hand_R'].matrix_local;T=source_arm.matrix_world.inverted()@source.matrix_world;allowed=set(ids);faces=[f for f in source.data.polygons if all(i in allowed for i in f.vertices)];used=sorted({i for f in faces for i in f.vertices});lookup={old:new for new,old in enumerate(used)};verts=[]
 for i in used:
  p=sourceHand.inverted()@T@source.data.vertices[i].co;p.x*=.92;p.y=.15+(p.y-.15)*.92;verts.append(targetHand@p)
 data=bpy.data.meshes.new('Actual retained source mounted lancer spear');data.from_pydata(verts,[],[tuple(lookup[i] for i in f.vertices) for f in faces]);data.update();o=bpy.data.objects.new(role+' actual source spear in closed right palm',data);detail.objects.link(o);o.parent=target;o.matrix_basis=Matrix.Identity(4);o.matrix_parent_inverse=Matrix.Identity(4);o.vertex_groups.new(name='hand_R').add(list(range(len(verts))),1,'REPLACE');mod=o.modifiers.new('Existing actual mounted hand','ARMATURE');mod.object=target
 for mat in source.data.materials:data.materials.append(mat)
 uv=data.uv_layers.new(name='Original source spear UV')
 for new,old in zip(data.polygons,faces):
  new.material_index=old.material_index;new.use_smooth=old.use_smooth
  for li,oli in zip(new.loop_indices,old.loop_indices):uv.data[li].uv=source.data.uv_layers.active.data[oli].uv
 o['peris_role']=role;o['asset_license']='CC-BY-SA-3.0';o['asset_author']='Wildfire Games original spear; Peris seated hand fit';o['peris_atlas_partition']='original-panda-final-kit';o['runtime_approved']=False;o['peris_unit_finished']=False
 rows.append({'role':role,'actualSourceSpearVertices':len(verts),'sourceShaftTipUVPreserved':True,'radialScaleForExistingGripClearance':.92,'handSocket':[0,.15,0],'newBinding':'hand_R'})
 # Shorter, readable guandao head replaces the small infantry sword silhouette.
 # Exact current idle hand axis sets the blade's upward sign; shaft passes
 # through the unchanged measured closed palm instead of adding a fake grip.
 role='line_infantry';arm=_rig(collection,role);_pose(arms,saved,role,'idle',1);H=arm.data.bones['hand_R'].matrix_local;worldH=arm.matrix_world@arm.pose.bones['hand_R'].matrix;sign=1 if (worldH.to_3x3()@Vector((0,0,1))).z>=0 else -1;g=Gear(detail,arm,role);removed=0
 for obj in list(collection.all_objects):
  if obj.type!='MESH' or obj.get('peris_role')!=role or obj.get('peris_atlas_partition')!='original-bear-detail':continue
  group=obj.vertex_groups.get('hand_R')
  if not group:continue
  bm=bmesh.new();bm.from_mesh(obj.data);layer=bm.verts.layers.deform.active;cut=[v for v in bm.verts if v[layer].get(group.index,0)>.99];removed+=len(cut);bmesh.ops.delete(bm,geom=cut,context='VERTS');bm.to_mesh(obj.data);bm.free();obj.data.update()
 local=lambda x,y,z:H@Vector((x,.15+y,z*sign));g.curve('actual guandao continuous wrapped staff',[local(0,0,-.65),local(0,0,.72)],.045,'hand_R',leather,3,handles='VECTOR')
 for z in [-.52,.38,.66]:g.sphere('guandao bound bronze staff ring',local(0,0,z),(.056,.056,.025),'hand_R',gold,16,8)
 outline=[(0,.65),(.12,.69),(.28,.83),(.38,1.04),(.34,1.27),(.17,1.51),(.10,1.63),(.045,1.52),(.075,1.23),(.03,1.04),(-.025,.82)];v=[local(x,y,z) for y in [-.018,.018] for x,z in outline];n=len(outline);faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)];mesh=bpy.data.meshes.new('Curved volumetric guandao blade');mesh.from_pydata(v,[],faces);mesh.update();obj=bpy.data.objects.new('Forged curved guandao blade',mesh);detail.objects.link(obj);g.attach(obj,'hand_R',steel);g.curve('guandao jade heel mount',[local(.045,-.035,.69),local(.09,-.035,.79),local(.05,-.035,.90)],.036,'hand_R',jade,4)
 rows.append({'role':role,'removedOriginalShortWeaponVertices':removed,'originalGuandaoStaffAndClosedBlade':True,'bladeAxisSignFromActualIdle':sign,'measuredGripRadius':.045,'handSocket':[0,.15,0],'rigAndClipNamesPreserved':True})
 # One raised red plume and a modest rear standard identify the elite, with
 # actual attachment to its existing fitted helmet/back sockets.
 role='elite';arm=_rig(collection,role);g=Gear(detail,arm,role);h=arm.data.bones['head'].head_local+Vector((0,-.035,.14))
 for i in range(7):
  z=.43+i*.045;g.curve('elite connected swept crimson helmet plume '+str(i),[h+Vector((0,-.045+i*.018,z)),h+Vector((0,.15+i*.01,z+.12)),h+Vector((0,.31+i*.015,z+.06))],.021,'head',red,4)
 back='prop-back' if 'prop-back' in arm.data.bones else 'chest';c=arm.data.bones['chest'].head_local;g.curve('elite actual back standard stave',[c+Vector((.30,.32,-.2)),c+Vector((.30,.32,.85))],.018,back,gold,3,handles='VECTOR');g.cube('elite jade rear banner cloth',c+Vector((.09,.32,.56)),(.42,.026,.49),back,jade,.016);rows.append({'role':role,'connectedRedHelmetPlume':True,'smallBackStandard':True})
 # Fitted front greaves preserve actual black paws and the support footprint.
 for role in ['line_infantry','spear_guard','elite','light_cavalry','heavy_cavalry']:
  arm=_rig(collection,role);g=Gear(detail,arm,role)
  for side in ['L','R']:
   b=arm.data.bones['leg_'+side];p=b.head_local.lerp(b.tail_local,.47);g.sphere('convex jade shin guard '+side,p+Vector((0,-.10,0)),(.115,.065,(b.tail_local-b.head_local).length*.27),b.name,gold,16,10);g.sphere('inset weathered jade greave '+side,p+Vector((0,-.155,0)),(.088,.023,(b.tail_local-b.head_local).length*.23),b.name,jade,16,10)
  rows.append({'role':role,'fittedFrontJadeGreaves':2,'originalPawsSupportFeetUnchanged':True})
 # Tack follows actual existing animal head/spine bones; no added controls.
 for role in ['scout','light_cavalry','heavy_cavalry']:
  mount=next(m.object for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role for m in o.modifiers if m.type=='ARMATURE' and 'hand_R' not in m.object.data.bones);g=Gear(detail,mount,role);head=next(b for b in mount.data.bones if b.name in ['Horse_Head','Elephantidae_Head']);headpoints=[]
  for obj in collection.all_objects:
   if obj.type!='MESH' or obj.get('peris_role')!=role or obj.parent!=mount:continue
   tr=mount.matrix_world.inverted()@obj.matrix_world;headpoints += [tr@obj.data.vertices[i].co for i in _group_ids(obj,head.name)]
  lo=Vector([min(p[i] for p in headpoints) for i in range(3)]);hi=Vector([max(p[i] for p in headpoints) for i in range(3)]);center=(lo+hi)*.5;span=hi-lo
  if role=='heavy_cavalry':
   # The head's actual bounds locate the brow; tusk ends are not armor centers.
   brow=head.head_local+Vector((.06,-.08,.11));g.sphere('fitted dimensional mammoth jade brow plate',brow,(span.x*.13,span.y*.30,span.z*.15),head.name,jade,20,12);g.sphere('mammoth bronze raised brow seal',brow+Vector((0,-.06,.055)),(.07,.045,.07),head.name,gold,16,10)
  else:
   g.sphere('mounted jade bridle cheek seal',center+Vector((0,-span.y*.39,span.z*.09)),(.07,.035,.085),head.name,gold,16,10)
  rows.append({'role':role,'actualExistingAnimalHeadTackDetails':True,'newBonesOrActions':0})
 for obj in list(detail.objects):
  if obj.type=='MESH':obj['peris_atlas_partition']='original-panda-final-kit'
 _restore(arms,saved,frame);return rows
