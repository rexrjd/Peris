"""Preserved Elf/Demon reference-kit derivative, with measured real-hand gear.

Input is the immutable editable V4 source. Approved faces/clothing are retained;
specific role weapon/armor distinctions are authored as original Peris geometry.
Source prop helmets, actual poles and shield fields are treated explicitly.
"""
import argparse,bpy,bmesh,pathlib,sys,json,hashlib,math,types
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from fantasy_portrait_quality import mesh,curve,material,chest_surface
from prototype_contact_floor import normalize_role_ground
from roster_atlas import pack
P=argparse.ArgumentParser();P.add_argument('--race',required=True);P.add_argument('--source-edition',required=True);P.add_argument('--edition',required=True);P.add_argument('--fit-roles',nargs='*',default=['heavy_cavalry'])
A=P.parse_args(sys.argv[sys.argv.index('--')+1:]);source=ROOT/'assets/source/battle'/A.source_edition/f'editable-{A.race}-study.blend';out=ROOT/'assets/source/battle'/A.edition
if out.exists():raise FileExistsError(out)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();original_hash=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
col=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections['FANTASY_PORTRAIT_NEW_COMPONENTS'];scene=bpy.context.scene;records=[];race=A.race
roles=['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry','ram','catapult']
def body_for(role):
 return next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and o not in set(new.objects) and any(m.type=='ARMATURE' and 'hand_R' in m.object.data.bones for m in o.modifiers))
def rig_for(role):return next(m.object for m in body_for(role).modifiers if m.type=='ARMATURE')
arms=[o for o in col.all_objects if o.type=='ARMATURE'];basis={a:{b.name:b.matrix_basis.copy() for b in a.pose.bones} for a in arms}
def sample(state='idle',frame=1):
 for a in arms:
  a.animation_data.action=None
  for n,m in basis[a].items():a.pose.bones[n].matrix_basis=m.copy()
  for t in a.animation_data.nla_tracks:t.mute=not t.name.endswith('_'+state)
 scene.frame_set(-1);scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update()
sample()
gold=material(race+' reference-kit aged gold copper',(.40,.30,.15) if race=='elf' else (.36,.135,.046),.76,.50)
metal=material(race+' reference-kit worked silver blackiron',(.26,.32,.29) if race=='elf' else (.043,.036,.031),.73,.57)
edge=material(race+' reference-kit honed bevel',(.60,.64,.61) if race=='elf' else (.22,.23,.23),.84,.39)
leather=material(race+' reference-kit textured harness',(.11,.064,.028) if race=='elf' else (.051,.027,.020),0,.90,'cloth')
cloth=material(race+' reference-kit contrasting woven mantle',(.18,.24,.14) if race=='elf' else (.24,.035,.023),0,.92,'cloth')

def plate(name,outline,center,arm,role,bone,mat=metal,trim=True):
 n=len(outline);vertices=outline+[center]+[p+Vector((0,.018,0)) for p in outline];faces=[(i,(i+1)%n,n) for i in range(n)]+[tuple(range(n+1,2*n+1))]+[(i,n+1+i,n+1+(i+1)%n,(i+1)%n) for i in range(n)]
 o=mesh(name,vertices,faces,arm,role,bone,mat,new,smooth=False)
 if trim:curve(name+' complete worked edge',outline+[outline[0]],.010,arm,role,bone,gold,new)
 return o

def clear_source_helmet(role):
 body=body_for(role);arm=rig_for(role);bm=bmesh.new();bm.from_mesh(body.data);d=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups};pending=set(bm.verts);drop=[];removed=[]
 while pending:
  seed=pending.pop();part={seed};todo=[seed]
  while todo:
   for e in todo.pop().link_edges:
    for v in e.verts:
     if v in pending:pending.remove(v);part.add(v);todo.append(v)
  weights={}
  for v in part:
   for i,w in v[d].items():weights[names[i]]=weights.get(names[i],0)+w/len(part)
  dominant=max(weights,key=weights.get) if weights else ''
  if 'helmet' in dominant.lower() and weights[dominant]>.85:drop.extend(part);removed.append({'bone':dominant,'vertices':len(part)})
 if drop:bmesh.ops.delete(bm,geom=drop,context='VERTS');bm.to_mesh(body.data);body.data.update()
 bm.free();return removed

def clear_actual_pole(role):
 body=body_for(role);arm=rig_for(role);hand=arm.data.bones['hand_R'].matrix_local.inverted();bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;ids={g.index for g in body.vertex_groups if g.name=='hand_R'};pending=set(bm.verts);drop=[]
 while pending:
  seed=pending.pop();part={seed};todo=[seed]
  while todo:
   for e in todo.pop().link_edges:
    for v in e.verts:
     if v in pending:pending.remove(v);part.add(v);todo.append(v)
  rigid=sum(sum(w for i,w in v[layer].items() if i in ids) for v in part)/len(part)
  pts=[hand@v.co for v in part];span=max(max(p[i] for p in pts)-min(p[i] for p in pts) for i in range(3));center=sum(pts,Vector())/len(pts)
  if rigid>.999 and (span>.5 or (abs(center.z)>.25 and math.hypot(center.x,center.y-.15)<.45)):drop.extend(part)
 if drop:bmesh.ops.delete(bm,geom=drop,context='VERTS');bm.to_mesh(body.data);body.data.update()
 bm.free();return len(drop)

def role_pole(role,kind):
 arm=rig_for(role);hand=arm.data.bones['hand_R'];m=hand.matrix_local@Matrix.Translation((0,.15,0));axis=arm.matrix_world.to_3x3()@arm.pose.bones['hand_R'].matrix.to_3x3()@Vector((0,0,1))
 if axis.z<0:m=m@Matrix.Rotation(math.pi,4,'Y')
 if kind=='leaf-glaive':outline=[(-.03,1.23),(-.11,1.50),(-.26,1.72),(-.28,2.02),(-.17,2.31),(.035,2.48),(.01,2.19),(.12,1.86),(.11,1.52)]
 elif kind=='crescent-glaive':outline=[(-.04,1.00),(-.14,1.18),(-.37,1.13),(-.49,1.43),(-.47,1.82),(-.30,2.15),(.015,2.37),(-.03,2.08),(.14,1.80),(.12,1.32)]
 else:outline=[(-.035,1.39),(-.14,1.72),(-.07,2.10),(0,2.32),(.07,2.10),(.14,1.72),(.035,1.39)]
 n=len(outline);vertices=[m@Vector((x,y,z)) for y in [-.023,.023] for x,z in outline];faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 blade=mesh('Distinct '+kind+' forged blade',vertices,faces,arm,role,'hand_R',metal,new)
 blade['peris_reference_weapon']=kind;blade['peris_grip_axis_hand_local']='Z';blade['peris_grip_center_hand_local']=[0,.15,0]
 curve('Distinct '+kind+' honed cutting bevel',[m@Vector((x,-.027,z)) for x,z in outline[:5]],.010,arm,role,'hand_R',edge,new)
 curve('Measured continuous pole haft',[m@Vector((0,0,-1.03)),m@Vector((0,0,1.60))],.042,arm,role,'hand_R',leather,new)
 for z in [-.23,-.15,-.075,.00,.075,.15,.22,1.10,1.26]:
  # Keep palm span under the measured .043 grip clearance.
  radius=.042 if abs(z)<.24 else .056
  curve('Wrapped shaft ferrule',[m@Vector((math.sin(i*math.tau/20)*radius,math.cos(i*math.tau/20)*radius,z)) for i in range(21)],.002 if abs(z)<.24 else .009,arm,role,'hand_R',gold,new)
 if role=='spear_guard':
  points=[m@Vector((.07,0,1.44)),m@Vector((.10,.025,1.13)),m@Vector((.15,.03,.83))];curve('Pike rank pennant tassel',points,.018,arm,role,'hand_R',cloth,new)
 return {'role':role,'weapon':kind,'shaftRadius':.042,'ferruleMaximumPalmRadius':.044,'handBone':'hand_R','gripReservation':.045,'sourceRigActionsUnchanged':True}

def distinct_armor(role):
 arm=rig_for(role);body=body_for(role);tree=chest_surface(body,arm);chest=arm.data.bones['chest'].head_local;hip=arm.data.bones['hip'].head_local
 def at(x,z,clear=.055):
  hit=tree.ray_cast(Vector((x,-1.4,z)),Vector((0,1,0)),2.8)[0];return Vector((x,(hit.y if hit else -.24)-clear,z))
 if role=='elite':
  # Broad, visibly heavier cuirass sections and rank-specific skirt plates.
  for row in range(3):
   z=chest.z+.22-row*.24
   for side in [-1,1]:
    x=side*.17;outline=[at(x,z+.17,.09),at(x-side*.145,z+.10,.09),at(x-side*.15,z-.11,.09),at(x,z-.20,.10),at(x+side*.17,z-.08,.09),at(x+side*.16,z+.10,.09)]
    plate('Elite raised segmented '+('leaf' if race=='elf' else 'obsidian')+' breastplate',outline,at(x,z,.135),arm,role,'chest')
  for side in [-1,1]:
   bone='arm_'+('L' if side>0 else 'R');c=arm.data.bones[bone].head_local
   outline=[c+Vector((side*x,y,z)) for x,y,z in [(-.10,-.22,.12),(.11,-.27,.19),(.37,-.18,.09),(.42,.05,-.05),(.24,.24,-.10),(-.11,.20,.06)]]
   plate('Elite substantial angular layered pauldron',outline,c+Vector((side*.10,-.025,.23)),arm,role,bone)
   if race=='demon':
    for x,y,z in [(.13,-.13,.20),(.26,.015,.18),(.17,.14,.17)]:curve('Elite rooted iron shoulder spike',[c+Vector((side*x,y,z)),c+Vector((side*(x+.06),y,z+.20))],.042,arm,role,bone,metal,new)
  for side in [-1,1]:
   for j in range(3):
    x=side*(.13+j*.105);z=hip.z-.20;outline=[Vector((x-.067,-.26,z+.15)),Vector((x+.067,-.26,z+.15)),Vector((x+.073,-.28,z-.29)),Vector((x,-.32,z-.36)),Vector((x-.07,-.28,z-.27))]
    plate('Elite overlapping hip leaf tasset',outline,Vector((x,-.34,z-.04)),arm,role,'hip')
 elif role=='spear_guard':
  for side in [-1,1]:
   for row in range(4):
    x=side*.165;z=chest.z+.25-row*.19;outline=[at(x-.11,z+.095,.055),at(x+.11,z+.08,.055),at(x+.095,z-.10,.065),at(x,z-.14,.078),at(x-.10,z-.09,.065)]
    plate('Pike Guard reinforced vertical scale',outline,at(x,z,.089),arm,role,'chest',trim=row%2==0)
 elif role in ['scout','archer']:
  # Lighter role reads as fitted hide rather than another full plate warrior.
  for o in new.objects:
   if o.get('peris_role')==role and ('cuirass' in o.name.lower() or 'companion backplate' in o.name.lower() or 'side corslet' in o.name.lower()):o.data.materials.clear();o.data.materials.append(leather)
  if role=='scout':
   for side in [-1,1]:
    c=arm.data.bones['hip'].head_local+Vector((side*.36,.12,-.05));outline=[c+Vector((x,y,z)) for x,y,z in [(-.11,0,.15),(.11,0,.15),(.14,-.01,-.17),(-.14,-.01,-.17)]]
    plate('Scout soft strapped supply satchel',outline,c+Vector((0,-.05,0)),arm,role,'hip',leather)
   for o in new.objects:
    if o.get('peris_role')==role and 'hood' in o.name.lower() and 'seam' not in o.name.lower():o.data.materials.clear();o.data.materials.append(cloth)
 for side in [-1,1]:
  if role in ['elite','spear_guard','light_cavalry','heavy_cavalry']:
   p=arm.data.bones['forearm_'+('L' if side>0 else 'R')];center=p.head_local+p.vector*.5
   # Rivet groups follow the original rigid forearm plate, not the moving torso.
   for k in range(4):
    c=center+Vector((side*.10,-.075,(k-1.5)*.07));curve('Role bracer patterned rank rivet',[c,c+Vector((0,-.012,0))],.012,arm,role,p.name,gold,new)
 return {'role':role,'rankDistinctArmor':True,'geometry':'Fitted segmented elite cuirass/tassets, reinforced pike scales, lighter scout/archer hide and supply kit','sourceBodyRigClipsPreserved':True}

def shields(role):
 arm=rig_for(role);items=[]
 for o in col.all_objects:
  if o.type!='MESH' or o.get('peris_role')!=role:continue
  groups={g.index for g in o.vertex_groups if g.name.startswith('prop-shield')};vertices=[v.index for v in o.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>.99]
  if vertices:items.append((o,vertices))
 if not items:return
 # All real field/rim/device points retain the same rest geometry and share grip owner.
 for o,ids in items:
  g=o.vertex_groups.get('hand_L') or o.vertex_groups.new(name='hand_L')
  for i in ids:
   for old in list(o.data.vertices[i].groups):o.vertex_groups[old.group].remove([i])
   g.add([i],1,'REPLACE')
 # Bare credited skull vertices and actual supported humanoid foot geometry,
 # independent of a seated pose or arbitrarily long editor bone endpoints.
 headpoints=[];footpoints=[]
 for o in col.all_objects:
  if o.type!='MESH' or o.get('peris_role')!=role or not any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers):continue
  transform=arm.matrix_world.inverted()@o.matrix_world;names={g.index:g.name for g in o.vertex_groups}
  if str(o.get('peris_atlas_partition','')).startswith('licensed-'):
   headpoints.extend(transform@v.co for v in o.data.vertices)
  for v in o.data.vertices:
   if sum(g.weight for g in v.groups if names[g.group] in ['foot_L','foot_R','toe_L','toe_R'])>.5:footpoints.append(transform@v.co)
 if not headpoints or not footpoints:raise ValueError('Actual bare head/foot geometry required for '+role)
 top=max(p.z for p in headpoints);bottom=min(p.z for p in footpoints);height=top-bottom
 basis_shield=arm.data.bones['prop-shield'].matrix_local;inverse=basis_shield.inverted();anchor=inverse@(arm.data.bones['hand_L'].matrix_local@Vector((0,.15,0)));points=[]
 for o,ids in items:
  transform=arm.matrix_world.inverted()@o.matrix_world;points.extend(inverse@transform@o.data.vertices[i].co for i in ids)
 old=max(p.z for p in points)-min(p.z for p in points);world_body=(arm.matrix_world.to_3x3()@Vector((0,0,height))).length;world_shield_axis=(arm.matrix_world.to_3x3()@basis_shield.to_3x3()@Vector((0,0,1))).length;factor=.60*world_body/(old*world_shield_axis)
 for o,ids in items:
  transform=arm.matrix_world.inverted()@o.matrix_world;undo=transform.inverted()
  for i in ids:
   p=inverse@transform@o.data.vertices[i].co;p.x=anchor.x+(p.x-anchor.x)*factor;p.z=anchor.z+(p.z-anchor.z)*factor;o.data.vertices[i].co=undo@basis_shield@p
  o.data.update()
 records.append({'role':role,'shieldFieldVerticesHandBound':sum(len(ids) for o,ids in items),'fieldHandleSameBone':'hand_L','standingHeightRatio':.60,'standingBareHeadTopLocalZ':top,'actualSupportFootBottomLocalZ':bottom,'bareBodyHeightLocal':height,'beforeShieldHeightWorld':old*world_shield_axis,'afterShieldHeightWorld':.60*world_body,'proportionalWidthHeightScale':factor,'handleRadiusSocketDepthUnchanged':True,'requiresActualIdleAttackReview':True})

def mineral_giant():
 body=body_for('catapult');arm=rig_for('catapult');stone=material('Elf rootstone coherent granite body',(.20,.215,.21),0,.95,'stone');names={g.index:g.name for g in body.vertex_groups};body.data.materials.append(stone);slot=len(body.data.materials)-1
 count=0
 for p in body.data.polygons:
  # Body material is explicit skin anatomy, including fingers and feet. Keep root/cloth props.
  own=sum(g.weight for i in p.vertices for g in body.data.vertices[i].groups if names[g.group] in ['hip','spine','chest','neck','head','arm_L','arm_R','forearm_L','forearm_R','hand_L','hand_R','thigh_L','thigh_R','leg_L','leg_R','foot_L','foot_R','toe_L','toe_R'] or names[g.group].startswith(('finger','thumb')))/len(p.vertices)
  if own>.5:p.material_index=slot;count+=1
 for o in new.objects:
  if o.get('peris_role')=='catapult' and ('head' in o.name.lower() or 'pointed elf ear' in o.name.lower()) and 'eye' not in o.name.lower():o.data.materials.clear();o.data.materials.append(stone)
 records.append({'role':'catapult','explicitMineralBodyFaces':count,'sameHeadBodyGraniteMaterial':True,'sourceThrowSkinWeightsUnchanged':True})

for role in roles[:7]:
 records.append({'role':role,'removedInheritedHumanHelmetParts':clear_source_helmet(role)})
 if role in ['spear_guard','elite']:
  removed=clear_actual_pole(role);records.append({'role':role,'removedSupersededPoleVertices':removed})
  records.append(role_pole(role,'leaf-glaive' if race=='elf' and role=='elite' else 'crescent-glaive' if race=='demon' and role=='elite' else 'ornate-pike'))
 if race=='demon' and role=='line_infantry':
  for o in list(new.objects):
   if o.get('peris_role')==role and any(t in o.name.lower() for t in ['crescent war cleaver','wrapped functional weapon haft','forged swept leaf guard','hilt crossed leather']):bpy.data.objects.remove(o,do_unlink=True)
  records.append(role_pole(role,'crescent-glaive'))
 records.append(distinct_armor(role));shields(role)
 # Elite reference carries a two-handed rank glaive, no competing shield silhouette.
 if role=='elite':
  for o in list(new.objects):
   if o.get('peris_role')==role and 'shield' in o.name.lower():bpy.data.objects.remove(o,do_unlink=True)
  records.append({'role':role,'shieldRemovedToMatchAdvancedGlaivePortrait':True,'leftHandRequiresShaftOrReadyPoseReview':True})
 print('REFERENCE_KIT_ROLE_READY',race,role,flush=True)
if race=='elf':mineral_giant()
for o in list(new.all_objects):
 if o.name not in col.objects:col.objects.link(o)
floor=[];flags={o:o.hide_viewport for o in col.all_objects}
for role in A.fit_roles:
 owned=[o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role];rigs={m.object for o in owned for m in o.modifiers if m.type=='ARMATURE'};roots=[a for a in rigs if not a.parent]
 if len(roots)!=1:raise ValueError('One semantic root required '+role)
 root=roots[0]
 for o in list(col.all_objects):o.hide_viewport=o not in rigs and o not in owned
 names=[b.name for b in root.data.bones if any(t in b.name.lower() for t in ['foot','toe','hoof','paw']) or b.name in ['Horse_Hand_L','Horse_Hand_R','Elephantidae_Hand_L','Elephantidae_Hand_R','Deer01_L_Hand','Deer01_R_Hand','Deer01_L_Finger0','Deer01_R_Finger0']]
 if role=='ram':names=['l_mid','l_back','l_front','r_mid','r_back','r_front']
 if names:rec=normalize_role_ground(col,role,root,support_bones=names,clearance=.025,sample_step=.5,edition=A.edition)
 else:
  root_objects={o for o in owned if any(m.type=='ARMATURE' and m.object==root for m in o.modifiers)};rec=normalize_role_ground(col,role,root,vertex_selector=lambda o,v:o in root_objects,clearance=.025,sample_step=.5,edition=A.edition)
 floor.append(rec);print('REFERENCE_KIT_FLOOR_READY',race,role,rec['after']['minimumWorldZ'],flush=True)
for o,flag in flags.items():o.hide_viewport=flag
sample();out.mkdir(parents=True);editable=out/f'editable-{race}-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in roles if r!='ram'},PROFILE={'family':'spartan'});pack(lib,race+'-distinct-reference-kits',out/'textures',4096)
for o in new.all_objects:
 if o.name not in col.objects:col.objects.link(o)
native=out/f'peris-{race}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
record={'race':race,'edition':A.edition,'sourceNative':str(source),'sourceSha256':original_hash,'sourceUnchanged':sha(source)==original_hash,'references':['assets/concepts/faction-sheets-v1/'+race+'-characters.png','assets/concepts/faction-sheets-v1/'+race+'-advanced.png','public/art/battle/roster/'+race+'.png'],'operations':records,'groundContact':floor,'nativeFrames':[1,25],'exportRequirement':'Saved-baseline49 TRS clone then JSON node-name-only namespace','runtimeApproved':False,'finishedUnitApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2));print('REFERENCE_KITS_NATIVE_READY',json.dumps(record['files']),flush=True)
