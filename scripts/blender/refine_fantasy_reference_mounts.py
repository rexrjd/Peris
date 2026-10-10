"""Measured ready-rig mount/rider derivatives matching the saved portraits.

Elf scout: existing faction bowman on a smaller licensed elk. Demon scout:
approved bow rider on the accepted licensed wolf mount, retaining Wolf rest/binds.
Demon light: fitted spear horse pair with approved Demon head/skin and dark kit.
All source files remain immutable; no curves are transferred between species.
"""
import argparse,pathlib,sys,json,hashlib,math,types,bpy
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from fantasy_portrait_quality import material,mesh,curve,role_identity,demon_head,paint_demon_body_skin,demon_cloven_hooves
from orc_mounted_prototypes import seated_rider,cushion
from prototype_contact_floor import normalize_role_ground
from roster_atlas import pack
P=argparse.ArgumentParser();P.add_argument('--race',required=True);P.add_argument('--source-edition',required=True);P.add_argument('--edition',required=True);P.add_argument('--elf-spear-source',default='elf-portrait-quality-full-v7')
A=P.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/A.source_edition/f'editable-{A.race}-study.blend';out=ROOT/'assets/source/battle'/A.edition
if out.exists():raise FileExistsError(out)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();oldsha=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);col=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'];race=A.race;records=[];scene=bpy.context.scene
roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult']
pose_bases={a:{b.name:b.matrix_basis.copy() for b in a.pose.bones} for a in col.all_objects if a.type=='ARMATURE'}
def owns(o,a):return o.type=='MESH' and any(m.type=='ARMATURE' and m.object==a for m in o.modifiers)
def arms_for(role):return {m.object for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role for m in o.modifiers if m.type=='ARMATURE'}
def role_root(role):return next(a for a in arms_for(role) if not a.parent)
def rider_for(role):return next(a for a in arms_for(role) if 'hand_R' in a.data.bones)
def independent_actions(arm,role):
 pose_bases[arm]={b.name:b.matrix_basis.copy() for b in arm.pose.bones}
 arm.animation_data.action=None
 for track in arm.animation_data.nla_tracks:
  state=next(s for s in ['idle','walk','attack'] if track.name.endswith('_'+s));track.name=role+'_'+state
  for strip in track.strips:
   slot=strip.action_slot;identifier=slot.identifier if slot else None;action=strip.action.copy();action.name=role+'_'+state+' reference mount derivative';strip.action=action
   if identifier:
    match=next((s for s in action.slots if s.identifier==identifier),None)
    if match:strip.action_slot=match
 arm['peris_role']=role
def clone_rig(arm,role):
 a=arm.copy();a.data=arm.data.copy();a.name=role+' reference '+arm.name;col.objects.link(a);independent_actions(a,role);return a
def clone_mesh(o,arm,role,authored):
 old_arm=next(m.object for m in o.modifiers if m.type=='ARMATURE');relative=old_arm.matrix_world.inverted()@o.matrix_world
 obj=o.copy();obj.data=o.data.copy();obj.name=role+' reference '+o.name;obj.parent=arm;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_basis=relative;col.objects.link(obj)
 if authored:new.objects.link(obj)
 for m in obj.modifiers:
  if m.type=='ARMATURE':m.object=arm
 obj['peris_role']=role
 if obj.get('peris_component_credit'):
  credit=json.loads(obj['peris_component_credit']);credit['role']=role;obj['peris_component_credit']=json.dumps(credit)
 return obj
def sample(role,state='idle',frame=1):
 for a in [o for o in col.all_objects if o.type=='ARMATURE']:
  a.animation_data.action=None
  if a not in pose_bases:raise ValueError('Saved baseline missing '+a.name)
  for name,m in pose_bases[a].items():a.pose.bones[name].matrix_basis=m.copy()
  for t in a.animation_data.nla_tracks:t.mute=(t.name!=role+'_'+state) if role is not None else not t.name.endswith('_idle')
 scene.frame_set(-1);scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
def remove_role(role,keep=()):
 items=[o for o in list(col.all_objects) if o.get('peris_role')==role and o not in keep]
 # Source armature objects may not carry role extras; modifiers supply ownership.
 rigs=arms_for(role)-set(keep)
 for o in items:
  if o.type!='ARMATURE':bpy.data.objects.remove(o,do_unlink=True)
 for a in rigs:
  if a.name in bpy.data.objects:bpy.data.objects.remove(a,do_unlink=True)
def mount_surface(mount):
 objs=[o for o in col.all_objects if owns(o,mount)];deps=bpy.context.evaluated_depsgraph_get();verts=[];faces=[]
 for o in objs:
  if 'rein' in o.name.lower():continue
  ev=o.evaluated_get(deps);d=ev.to_mesh();base=len(verts);verts.extend(ev.matrix_world@v.co for v in d.vertices);faces.extend(tuple(base+i for i in p.vertices) for p in d.polygons);ev.to_mesh_clear()
 return BVHTree.FromPolygons(verts,faces),verts
def attach_seated(mount,rider,role):
 sample(role);seatname='peris_seated_rider' if 'peris_seated_rider' in mount.data.bones else next(b.name for b in mount.data.bones if 'rider' in b.name.lower());seat=mount.data.bones[seatname]
 target=mount.matrix_world@mount.pose.bones[seatname].matrix.translation;tree,verts=mount_surface(mount);top=max(p.z for p in verts);hit=tree.ray_cast(Vector((target.x,target.y,top+1)),Vector((0,0,-1)),top-min(p.z for p in verts)+3)[0]
 if hit is None:
  print('MOUNT_BACK_RAY_MISS',role,'seat',list(target),'bounds',[[min(p[i] for p in verts),max(p[i] for p in verts)] for i in range(3)],flush=True)
  nearby=tree.find_nearest(target)
  if nearby is None or nearby[0] is None or nearby[3]>.8:raise ValueError('Measured animal back missing at retained seat '+role)
  hit=nearby[0]
  print('MOUNT_SEAT_NEAREST_SURFACE',role,list(hit),'distance',nearby[3],flush=True)
 target=hit+Vector((0,0,.16));before=rider.matrix_world.copy();hip=rider.pose.bones['hip'].head.copy();before.translation=target-before.to_3x3()@hip
 rider.parent=mount;rider.parent_type='BONE';rider.parent_bone=seatname;rider.matrix_parent_inverse=Matrix.Translation((0,-seat.length,0));rider.matrix_world=before;bpy.context.view_layer.update()
 # Width measured near back height; avoid antler/head extrema.
 near=[p for p in verts if abs(p.x-hit.x)<.35 and abs(p.z-hit.z)<.70]
 width=max(p.y for p in near)-min(p.y for p in near) if near else 1.1
 seated_rider(mount,rider,role,target,width,hold_reins=False);sample(role)
 measured=rider.matrix_world@rider.pose.bones['hip'].head
 error=(measured-target).length
 if error>.005:raise ValueError('Measured mounted pelvis missed the animal-back target')
 rider['peris_seat_hip_world']=list(measured);rider['peris_seat_target_world']=list(target);rider['peris_seat_fit_error']=error
 mat=material(race+' fitted saddle worn hide',(.075,.046,.022),0,.92,'cloth')
 o=cushion(mount,seatname,role,hit+Vector((0,0,.065)),.95,max(.85,width*.83),.15,mat,name='Reference fitted curved riding saddle');new.objects.link(o)
 records.append({'role':role,'riderSeatBone':seatname,'measuredBackHitWorld':list(hit),'hipTargetWorld':list(target),'measuredFlankWidthWorld':width,'riderHipThighKneeChannelsAuthored':True,'animalRestBindingsAndSourceSpeciesAnimationsPreserved':True,'retainedBodyArmBowOrPoleMotion':True,'requiresActualAllPoseReview':True})
 return hit,width
def append_role(path,role):
 before=set(bpy.data.objects)
 with bpy.data.libraries.load(str(path),link=False) as (lib,target):target.objects=[n for n in lib.objects if role in n]
 incoming=[o for o in target.objects if o];rigs={m.object for o in incoming if o.type=='MESH' and o.get('peris_role')==role for m in o.modifiers if m.type=='ARMATURE'}
 incoming=list(set(incoming)|rigs)
 return incoming,rigs

if race=='elf':
 original_elk=role_root('heavy_cavalry');elk_parts=[o for o in col.all_objects if owns(o,original_elk)];original_bow=rider_for('archer');bow_parts=[o for o in col.all_objects if owns(o,original_bow)]
 elk=clone_rig(original_elk,'scout');elk.scale*=.76
 for o in elk_parts:clone_mesh(o,elk,'scout',o in set(new.objects))
 bow=clone_rig(original_bow,'scout')
 for o in bow_parts:clone_mesh(o,bow,'scout',o in set(new.objects))
 keep=[elk,bow]+[o for o in col.all_objects if owns(o,elk) or owns(o,bow)];remove_role('scout',keep);sample('scout');hit,width=attach_seated(elk,bow,'scout')
 body=next(o for o in col.all_objects if owns(o,bow) and o not in set(new.objects));role_identity(bow,'scout',body,new,'elf');elk['peris_mount_species']='smaller scouting elk';records.append({'role':'scout','referenceDifference':'Hooded lighter bow rider on smaller elk, replacing duplicate horse spearman','readySourceRiderRole':'archer','readySourceMountRole':'heavy_cavalry','sourceGeometryCreditsPreserved':True})
else:
 wolf_path=ROOT/'assets/source/battle/orc-mounted-fitting-v8i/peris-orc-army.blend';incoming,rigs=append_role(wolf_path,'scout');wolf=next(a for a in rigs if 'hand_R' not in a.data.bones and 'Head' in a.data.bones);wolf_parts=[o for o in incoming if owns(o,wolf)];rider=rider_for('scout');old_mount=role_root('scout');old_parts=[o for o in col.all_objects if owns(o,old_mount)]
 col.objects.link(wolf);wolf.name='scout Demon licensed fitted wolf';independent_actions(wolf,'scout')
 for o in wolf_parts:
  col.objects.link(o);o['peris_role']='scout';o.name='scout Demon '+o.name
  # Black natural fur finish replaces the accepted Orc gray, preserving UVs.
  fur=material('Demon scout coal black wolf fur',(.033,.029,.026),0,.94,'cloth')
  for i,mat in enumerate(o.data.materials):
   if any(t in mat.name.lower() for t in ['fur','coat','gray','wolf','atlas']):o.data.materials[i]=fur
 rider_world=rider.matrix_world.copy();rider.parent=None;rider.matrix_parent_inverse=Matrix.Identity(4);rider.matrix_world=rider_world
 for o in old_parts:bpy.data.objects.remove(o,do_unlink=True)
 bpy.data.objects.remove(old_mount,do_unlink=True)
 for o in incoming:
  if o!=wolf and o not in wolf_parts and o.name in bpy.data.objects:bpy.data.objects.remove(o,do_unlink=True)
 sample('scout');hit,width=attach_seated(wolf,rider,'scout');headbone='Head';h=wolf.matrix_world@wolf.pose.bones[headbone].head
 # Rooted curved horns distinguish the scout beast without hiding muzzle/paws.
 from orc_mounted_prototypes import prop_mesh
 horn=material('Demon scout wolf ridged horns',(.038,.025,.020),.08,.89)
 for sign in [-1,1]:
  points=[h+Vector((.10,sign*.24,.28)),h+Vector((-.15,sign*.37,.52)),h+Vector((-.38,sign*.34,.65))];verts=[];faces=[];n=12
  for row,p in enumerate(points):
   r=[.095,.055,.003][row]
   for i in range(n):t=i*math.tau/n;verts.append(p+Vector((r*math.cos(t),r*math.sin(t),0)))
  for row in range(2):
   for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
  faces.extend([tuple(range(n-1,-1,-1)),tuple(range(2*n,3*n))]);o=prop_mesh('Original Demon scout rooted wolf horn',verts,faces,wolf,headbone,'scout',horn);new.objects.link(o)
 wolf['peris_mount_species']='horned black scouting wolf';records.append({'role':'scout','referenceDifference':'Hooded bow rider on horned black wolf; no acquired Orc rider geometry copied','wolfSource':str(wolf_path),'wolfSourceSha256':sha(wolf_path),'wolfRigRestSkinBindingsPreserved':True})
 # Replace duplicate bow cavalry with the ready fitted faction spear-horse pair.
 elf_source=ROOT/'assets/source/battle'/A.elf_spear_source/'editable-elf-study.blend';incoming,rigs=append_role(elf_source,'light_cavalry');keep_mesh=[o for o in incoming if o.type=='MESH' and o.get('peris_role')=='light_cavalry'];keep_rigs={m.object for o in keep_mesh for m in o.modifiers if m.type=='ARMATURE'};remove_role('light_cavalry')
 for a in keep_rigs:
  col.objects.link(a);a.name='light_cavalry Demon reference '+a.name;independent_actions(a,'light_cavalry')
 for o in keep_mesh:
  col.objects.link(o);o['peris_role']='light_cavalry';o.name='light_cavalry Demon reference '+o.name
  if o.get('original_peris_equipment') or str(o.get('peris_atlas_partition','')).startswith('licensed-'):new.objects.link(o)
 light_rider=next(a for a in keep_rigs if 'hand_R' in a.data.bones);light_mount=next(a for a in keep_rigs if a!=light_rider)
 for o in list(keep_mesh):
  if owns(o,light_rider) and any(t in o.name.lower() for t in ['connected elf head','pointed elf ear','elf scalp','golden hair lock','iris','eye','brow circlet','leaf coronet']):bpy.data.objects.remove(o,do_unlink=True);keep_mesh.remove(o)
 sample('light_cavalry');demon_head(light_rider,'light_cavalry',new)
 body_candidates=[]
 for o in keep_mesh:
  if not owns(o,light_rider) or str(o.get('peris_atlas_partition','')).startswith('licensed-'):continue
  foot_ids={g.index for g in o.vertex_groups if g.name in ['foot_L','foot_R','toe_L','toe_R']}
  count=sum(1 for v in o.data.vertices if sum(g.weight for g in v.groups if g.group in foot_ids)>.55)
  if count:body_candidates.append((o,count))
 if not body_candidates:raise ValueError('Actual source rider foot-bearing body missing')
 body=max(body_candidates,key=lambda item:len(item[0].data.vertices))[0];print('DEMON_LIGHT_ACTUAL_BODY',body.name,len(body.data.vertices),flush=True);paint_demon_body_skin(light_rider,body);demon_cloven_hooves(light_rider,'light_cavalry',body,new)
 skin=material('Demon spearhorse rider warm red hand skin',(.30,.047,.028),0,.87);dark=material('Demon spearhorse blackiron fitted kit',(.041,.035,.032),.70,.62);copper=material('Demon spearhorse copper edges',(.36,.13,.047),.74,.54);redcloth=material('Demon spearhorse red ragged woven cloth',(.18,.030,.020),0,.92,'cloth')
 for o in keep_mesh:
  if o.name not in bpy.data.objects:continue
  if owns(o,light_rider):
   for i,m in enumerate(o.data.materials):
    name=m.name.lower();o.data.materials[i]=skin if any(t in name for t in ['grip skin','archer hand']) else copper if any(t in name for t in ['gold','precious','copper','trim']) else redcloth if any(t in name for t in ['cloak','cloth','mantle','robe']) else dark if any(t in name for t in ['iron','silver','metal','plate','greave','bracer','field']) else m
  elif owns(o,light_mount):
   horse=material('Demon black warhorse hide',(.030,.027,.026),0,.91,'cloth');o.data.materials.clear();o.data.materials.append(horse)
 records.append({'role':'light_cavalry','referenceDifference':'Actual spear-and-shield fitted horse pair instead of second bow scout','readySourceElfPair':str(elf_source),'readySourceSha256':sha(elf_source),'sourcePoleActualHandGripAndSeatRetained':True,'creditedDemonHeadAndRedAnatomyReplacedElfIdentity':True})

for o in list(new.all_objects):
 if o.name not in col.objects:col.objects.link(o)
floors=[];flags={o:o.hide_viewport for o in col.all_objects}
for role in ['scout']+(['light_cavalry'] if race=='demon' else []):
 owned=[o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role];rigs=arms_for(role);root=role_root(role)
 for o in list(col.all_objects):o.hide_viewport=o not in rigs and o not in owned
 bones=[b.name for b in root.data.bones if any(t in b.name.lower() for t in ['foot','toe','hoof','paw','leg3']) or b.name in ['Horse_Hand_L','Horse_Hand_R','Deer01_L_Hand','Deer01_R_Hand','Deer01_L_Finger0','Deer01_R_Finger0']]
 rec=normalize_role_ground(col,role,root,support_bones=bones,clearance=.025,sample_step=.5,allow_lowering=True,edition=A.edition);floors.append(rec);print('REFERENCE_MOUNT_FLOOR_READY',race,role,rec['after']['minimumWorldZ'],flush=True)
 if abs(rec['after']['minimumWorldZ']-.025)>1e-4:raise ValueError('New mount contact correction did not reach actual floor')
for o,f in flags.items():o.hide_viewport=f
sample(None)
out.mkdir(parents=True);editable=out/f'editable-{race}-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in roles if r!='ram'},PROFILE={'family':'spartan'});pack(lib,race+'-reference-mounted-kits',out/'textures',4096)
for o in new.all_objects:
 if o.name not in col.objects:col.objects.link(o)
native=out/f'peris-{race}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
record={'race':race,'sourceNative':str(source),'sourceSha256':oldsha,'sourceUnchanged':sha(source)==oldsha,'operations':records,'groundContact':floors,'nativeFrames':[1,25],'exportRequirement':'Saved baseline full49TRS then JSON namespace; all four actual species feet required','runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2));print('REFERENCE_MOUNTS_NATIVE_READY',json.dumps(record['files']),flush=True)
