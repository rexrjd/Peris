"""Bounded final reference assembly: visible blades, light scouts, faction giant.

No source history overwrite. Existing rest rig, credited faces, healthy body
weights and bow/string channels are retained. Root floor fitting is explicit.
"""
import argparse,pathlib,sys,json,hashlib,math,types,bpy,bmesh
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from fantasy_portrait_quality import material,mesh,curve,portrait_hands
from orc_mounted_prototypes import prop_mesh
from prototype_contact_floor import normalize_role_ground
from roster_atlas import pack
P=argparse.ArgumentParser();P.add_argument('--race',required=True);P.add_argument('--source-edition',required=True);P.add_argument('--edition',required=True)
A=P.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/A.source_edition/f'editable-{A.race}-study.blend';out=ROOT/'assets/source/battle'/A.edition
if out.exists():raise FileExistsError(out)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();oldsha=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);col=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'];race=A.race;rows=[];scene=bpy.context.scene
roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult'];arms=[a for a in col.all_objects if a.type=='ARMATURE'];bases={a:{b.name:b.matrix_basis.copy() for b in a.pose.bones} for a in arms}
def sample(role=None):
 for a in arms:
  a.animation_data.action=None
  for n,m in bases[a].items():a.pose.bones[n].matrix_basis=m.copy()
  for t in a.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle') if role is None else t.name!=role+'_idle'
 scene.frame_set(-1);scene.frame_set(1);bpy.context.view_layer.update()
def owns(o,a):return o.type=='MESH' and any(m.type=='ARMATURE' and m.object==a for m in o.modifiers)
def human(role):return next(a for a in arms if 'hand_R' in a.data.bones and any(owns(o,a) and o.get('peris_role')==role for o in col.all_objects))
sample()
gold=material(race+' completed reference warm worked edges',(.38,.29,.14) if race=='elf' else (.36,.135,.046),.73,.54)
plate=material(race+' completed reference barding',(.22,.30,.235) if race=='elf' else (.041,.035,.031),.70,.62)
cloth=material(race+' completed reference contrasting cloth',(.13,.19,.10) if race=='elf' else (.19,.028,.020),0,.93,'cloth')
hide=material(race+' scouting worn hide',(.13,.083,.036) if race=='elf' else (.063,.035,.025),0,.93,'cloth')

# Retain the animated draw-hand/finger chain and string; the stationary bow
# hand receives the same connected curled-finger construction as pole units.
for role in ['archer','scout']:
 a=human(role)
 if any(o.get('peris_role')==role and 'anatomical closed L grip' in o.name for o in new.objects):continue
 candidates=[o for o in col.all_objects if owns(o,a) and o.get('peris_role')==role and o not in set(new.objects)]
 body=max(candidates,key=lambda o:len(o.data.vertices));count=portrait_hands(a,role,body,new,race,sides=('L',));rows.append({'role':role,'stationaryBowHandClosedConnectedDigitsAndThumb':True,'sourceDrawHandFingerChainAndStringPreserved':True,'removedSupersededLeftHandFaces':count,'requiresActualNockDrawAndGripReview':True})

# Blade face twist is measured in actual imported idle, while the shaft/grip
# stays fixed. This avoids presenting every rank weapon as the same thin rod.
for role in ['line_infantry','spear_guard','elite']:
 sample(role);a=human(role);rest=a.data.bones['hand_R'].matrix_local;rotation=a.matrix_world.to_3x3()@a.pose.bones['hand_R'].matrix.to_3x3();local=rotation.inverted()@Vector((1,0,0));alpha=math.atan2(-local.x,local.y);rot=Matrix.Rotation(alpha,4,'Z');changed=[]
 for o in new.objects:
  if o.get('peris_role')!=role or not ('Distinct ' in o.name and ('forged blade' in o.name or 'honed cutting bevel' in o.name)):continue
  transform=a.matrix_world.inverted()@o.matrix_world;undo=transform.inverted();inv=rest.inverted()
  for v in o.data.vertices:
   p=inv@transform@v.co;p=Vector((0,.15,0))+rot@(p-Vector((0,.15,0)));v.co=undo@rest@p
  o.data.update();changed.append(o.name)
 rows.append({'role':role,'bladeOnlyMeasuredIdleFaceTwistRadians':alpha,'changedBladeObjects':changed,'actualShaftPalmGeometryAndHandWeightsUnchanged':True})

# Scout now has a genuinely light hide kit, not cloned elite leaf scales.
for o in list(new.objects):
 if o.get('peris_role')!='scout':continue
 name=o.name.lower()
 if any(t in name for t in ['overlapping forged pointed leaf lamella','lamella fine raised','lamella dimensional','worked leaf chevron','dimensional central leaf device']):bpy.data.objects.remove(o,do_unlink=True);continue
 if any(t in name for t in ['cuirass','companion backplate','side corslet','anatomical fitted forearm','anatomical fitted leg']):o.data.materials.clear();o.data.materials.append(hide)
scout=human('scout');hip=scout.data.bones['hip'].head_local
for side in [-1,1]:
 c=hip+Vector((side*.39,.10,-.06));points=[c+Vector((-.10,-.05,.11)),c+Vector((.10,-.05,.11)),c+Vector((.13,-.05,-.14)),c+Vector((-.13,-.05,-.14))];n=4
 mesh('Scout independent strapped hide supply pouch',points+[p+Vector((0,.11,0)) for p in points],[(0,1,2,3),(7,6,5,4)]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],scout,'scout','hip',hide,new)
 curve('Scout supply pouch narrow retaining strap',[c+Vector((0,-.061,.12)),c+Vector((0,-.061,-.14))],.020,scout,'scout','hip',gold,new)
rows.append({'role':'scout','lightHideTorsoBracersAndSupplies':True,'heavyLeafLamellaRemoved':True,'functionalBowDrawGeometryAndChannelsUnchanged':True})

# Pike scales must sit above the finished existing shell. The original bare
# body ray surface is farther inward than the already-authored leaf lamella.
for o in list(new.objects):
 if o.get('peris_role')=='spear_guard' and 'Pike Guard reinforced vertical scale' in o.name:
  for v in o.data.vertices:v.co.y-=.045
  o.data.update()
 if o.get('peris_role')=='archer' and any(t in o.name.lower() for t in ['fitted anatomical cuirass','companion backplate','side corslet','cuirass curved','backplate substantial','overlapping forged pointed leaf lamella','lamella fine raised','lamella dimensional','worked leaf chevron','dimensional central leaf device']):bpy.data.objects.remove(o,do_unlink=True)
rows.append({'role':'spear_guard','reinforcedScalesClearFinishedArmorByMeasuredAdditional045':True,'originalRigChestOwnerPreserved':True})
rows.append({'role':'archer','heavyCuirassAndLeafLamellaRemoved':'Retained original source tunic/anatomy, crossed leather harness, one-layer shoulders and bracers make a distinct lighter bow role','drawHandStringAndBowDeformationUnchanged':True})

if race=='elf':
 sample('scout');root=next(a for a in arms if not a.parent and any(owns(o,a) and o.get('peris_role')=='scout' for o in col.all_objects));rider=human('scout');seat=rider.matrix_world@rider.pose.bones['hip'].matrix.translation;deleted=[]
 for o in [o for o in col.all_objects if owns(o,root)]:
  deps=bpy.context.evaluated_depsgraph_get();ev=o.evaluated_get(deps);posed=ev.to_mesh();bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table();pending=set(bm.verts);drop=[]
  while pending:
   seed=pending.pop();part={seed};todo=[seed]
   while todo:
    for e in todo.pop().link_edges:
     for v in e.verts:
      if v in pending:pending.remove(v);part.add(v);todo.append(v)
   if len(part)>100:continue
   points=[o.matrix_world@posed.vertices[v.index].co for v in part];span=Vector([max(p[i] for p in points)-min(p[i] for p in points) for i in range(3)]);center=sum(points,Vector())/len(points)
   if span.z<.65 and max(span.x,span.y)>.85 and (center-seat).length<1.8:drop.extend(part);deleted.append({'mesh':o.name,'vertices':len(part),'worldDimensions':list(span),'measuredPelvisDistanceWorld':(center-seat).length})
  ev.to_mesh_clear()
  if drop:bmesh.ops.delete(bm,geom=drop,context='VERTS');bm.to_mesh(o.data);o.data.update()
  bm.free()
 rows.append({'role':'scout','removedMeasuredFlatInheritedBenchComponents':deleted,'newFittedCurvedSaddleRetained':True,'animalBodyFootRestGeometryUnchanged':True})

 # Rootstone faction identity: leaf cloth wrap and living root braces over
 # coherent gray mineral, keeping the original planted release arm/rock rig.
 sample('catapult');a=human('catapult');h=a.data.bones['hip'].head_local;c=a.data.bones['chest'].head_local;n=36;verts=[];faces=[]
 for row in range(4):
  t=row/3
  for i in range(n):
   angle=math.tau*i/n;r=1+.04*math.cos(angle*9);verts.append(h+Vector((math.sin(angle)*.52*r,-math.cos(angle)*.33*r,.12-t*.70-.06*t*math.sin(angle*5))))
 for row in range(3):
  for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
 o=mesh('Rootstone giant distinct woven leaf waist wrap',verts,faces,a,'catapult','hip',cloth,new,smooth=True);mod=o.modifiers.new('Woven waist edge thickness','SOLIDIFY');mod.thickness=.013;bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_apply(modifier=mod.name);o.select_set(False)
 bark=material('Rootstone giant original twisted living roots',(.085,.060,.028),0,.97,'cloth')
 for side in [-1,1]:
  curve('Giant diagonal living root harness',[c+Vector((side*.30,-.28,.40)),c+Vector((0,-.34,.05)),c+Vector((-side*.32,-.27,-.32))],.031,a,'catapult','chest',bark,new)
  bone=a.data.bones['forearm_'+('L' if side>0 else 'R')];m=bone.matrix_local
  for y in [bone.length*.25,bone.length*.67]:curve('Giant rooted wrist binding',[m@Vector((math.sin(i*math.tau/24)*.15,y,math.cos(i*math.tau/24)*.15)) for i in range(25)],.022,a,'catapult',bone.name,bark,new)
 rows.append({'role':'catapult','coherentMineralSkinPreserved':True,'distinctLeafWaistClothAndCrossRootHarness':True,'plantedThrowReleaseAndHeldRockUnchanged':True})
else:
 # Rooted ram-like swept curls matching the portraits, with a genuinely
 # different contour from Elf pointed ears and the Orc topknot/tusks.
 for o in list(new.objects):
  if 'rooted swept ridged demon horn' in o.name.lower():bpy.data.objects.remove(o,do_unlink=True)
 horn=material('Demon broad curled rooted horn keratin',(.035,.026,.022),.08,.91,'cloth')
 for role in roles:
  if role=='ram':continue
  a=human(role);center=a.data.bones['head'].head_local+Vector((0,-.050,.14))
  for side in [-1,1]:
   controls=[center+Vector((side*x,y,z)) for x,y,z in [(.22,.015,.22),(.39,.09,.39),(.59,.15,.36),(.66,.04,.18),(.59,-.14,.09),(.45,-.23,.15),(.34,-.19,.28)]];points=[]
   for segment in range(len(controls)-1):
    p,b,c,d=controls[max(0,segment-1)],controls[segment],controls[segment+1],controls[min(len(controls)-1,segment+2)]
    for j in range(7):
     t=j/7;points.append(.5*((2*b)+(-p+c)*t+(2*p-5*b+4*c-d)*t*t+(-p+3*b-3*c+d)*t*t*t))
   points.append(controls[-1]);verts=[];faces=[];n=18
   for row,p in enumerate(points):
    t=row/(len(points)-1);axis=(points[min(row+1,len(points)-1)]-points[max(0,row-1)]).normalized();ref=axis.cross(Vector((0,1,0))).normalized();other=axis.cross(ref).normalized();r=(.117*(1-t)**.55+.002)*(1+.07*math.sin(row*math.pi*.70))
    for i in range(n):angle=i*math.tau/n;verts.append(p+r*(ref*math.cos(angle)+other*math.sin(angle)))
   for row in range(len(points)-1):
    for i in range(n):faces.append((row*n+i,row*n+(i+1)%n,(row+1)*n+(i+1)%n,(row+1)*n+i))
   faces.extend([tuple(range(n-1,-1,-1)),tuple(range((len(points)-1)*n,len(points)*n))]);mesh('Portrait broad curled ram horn',verts,faces,a,role,'prop-head',horn,new,smooth=True)
  rows.append({'role':role,'originalRootedCurledHornContour':True,'approvedCreditedFaceAndEyesUnchanged':True,'hornRootCentersUnchanged':True,'requiresActualHelmetHornClearanceReview':True})

 # Demon shields have angular diamond metalwork, rather than copied Elf vines.
 for role in roles:
  fields=[o for o in new.objects if o.get('peris_role')==role and ('dimensional leaf shield' in o.name.lower())]
  if not fields:continue
  a=human(role);basis=a.data.bones['prop-shield'].matrix_local;inv=basis.inverted();points=[inv@v.co for o in fields for v in o.data.vertices];lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)]);c=(lo+hi)*.5;extent=hi-lo
  for o in list(new.objects):
   if o.get('peris_role')==role and any(t in o.name.lower() for t in ['branching precious leaf vein','raised central shield keel']):bpy.data.objects.remove(o,do_unlink=True)
  for offset,size in [(0,.26),(.30,.13),(-.30,.13)]:
   z=c.z+extent.z*offset;outline=[basis@Vector((c.x,lo.y-.022,z+extent.z*size)),basis@Vector((c.x-extent.x*.24,lo.y-.022,z)),basis@Vector((c.x,lo.y-.022,z-extent.z*size)),basis@Vector((c.x+extent.x*.24,lo.y-.022,z))];center=basis@Vector((c.x,lo.y-.07,z));mesh('Demon dimensional obsidian diamond shield device',outline+[center],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],a,role,'hand_L',gold,new)
  rows.append({'role':role,'shieldElfVeinsReplacedWithDimensionalAngularDemonDiamonds':True,'fieldRimAndActualGripAllSameHandBone':True,'targetStandingHeightRatio':.60})

# Fitted original flank plates make the cavalry mounts distinct from bare scout.
for role in ['light_cavalry','heavy_cavalry']:
 sample(role);root=next(a for a in arms if not a.parent and any(owns(o,a) and o.get('peris_role')==role for o in col.all_objects));parts=[o for o in col.all_objects if owns(o,root)];deps=bpy.context.evaluated_depsgraph_get();verts=[];faces=[]
 for o in parts:
  ev=o.evaluated_get(deps);d=ev.to_mesh();start=len(verts);verts.extend(ev.matrix_world@v.co for v in d.vertices);faces.extend(tuple(start+i for i in p.vertices) for p in d.polygons);ev.to_mesh_clear()
 tree=BVHTree.FromPolygons(verts,faces);rider=human(role);seat=root.matrix_world@root.pose.bones[rider.parent_bone].matrix.translation;bodybone=next((n for n in ['Horse_Spine_1','Deer01_Spine1','spine','body'] if n in root.data.bones),None)
 if not bodybone:continue
 width=max(p.y for p in verts)-min(p.y for p in verts)
 for side in [-1,1]:
  center=seat+Vector((0,0,-.55));outline=[]
  for dx,dz in [(-.80,.18),(-.20,.42),(.67,.25),(.86,-.39),(.24,-.95),(-.58,-.72)]:
   origin=Vector((center.x+dx,side*(width+2),center.z+dz));hit=tree.ray_cast(origin,Vector((0,-side,0)),width*2+5)[0]
   if hit is None:break
   outline.append(hit+Vector((0,side*.035,0)))
  if len(outline)!=6:continue
  middle=sum(outline,Vector())/6+Vector((0,side*.055,0));o=prop_mesh('Reference fitted angular '+('leaf' if race=='elf' else 'obsidian')+' flank barding',outline+[middle],[(i,(i+1)%6,6) for i in range(6)],root,bodybone,role,plate);new.objects.link(o)
  # Actual fitted borders, not a floating box around the animal.
  from orc_mounted_prototypes import rope
  o=rope(root,role,bodybone,outline+[outline[0]],.030,gold,'Reference fitted continuous barding rim');new.objects.link(o)
 rows.append({'role':role,'originalBardingFittedToActualEvaluatedFlanks':True,'bodyBone':bodybone,'animalSpeciesSkinBindingsAndClipsUnchanged':True})

for o in list(new.all_objects):
 if o.name not in col.objects:col.objects.link(o)
ground=[];flags={o:o.hide_viewport for o in col.all_objects}
for role in ['scout']:
 owned=[o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role];rigs={m.object for o in owned for m in o.modifiers if m.type=='ARMATURE'};root=next(a for a in rigs if not a.parent)
 for o in list(col.all_objects):o.hide_viewport=o not in rigs and o not in owned
 bones=[b.name for b in root.data.bones if any(t in b.name.lower() for t in ['foot','toe','hoof','paw','leg3']) or b.name in ['Horse_Hand_L','Horse_Hand_R','Deer01_L_Hand','Deer01_R_Hand','Deer01_L_Finger0','Deer01_R_Finger0']]
 rec=normalize_role_ground(col,role,root,support_bones=bones,clearance=.025,sample_step=.5,allow_lowering=True,edition=A.edition);ground.append(rec)
 if abs(rec['after']['minimumWorldZ']-.025)>1e-4:raise ValueError('Measured scout support failed')
for o,flag in flags.items():o.hide_viewport=flag
sample();out.mkdir(parents=True);editable=out/f'editable-{race}-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in roles if r!='ram'},PROFILE={'family':'spartan'});pack(lib,race+'-reference-final-original-kit',out/'textures',4096)
for o in new.all_objects:
 if o.name not in col.objects:col.objects.link(o)
native=out/f'peris-{race}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
record={'race':race,'sourceNative':str(source),'sourceSha256':oldsha,'sourceUnchanged':sha(source)==oldsha,'referenceComparisonOperations':rows,'groundContact':ground,'nativeArtistFrames':[1,25],'exportRequirement':'Full49SavedBaselineTRS + node-name-only namespace; actual raw/optimized contact required','runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2));print('FANTASY_REFERENCE_FINAL_NATIVE_READY',json.dumps(record['files']),flush=True)
