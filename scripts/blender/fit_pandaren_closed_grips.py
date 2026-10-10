"""Bounded original weapon/socket fitting on an immutable closed-grip study.

Moves the complete original held weapon, preserving shaft/tip dimensions and
UVs; only its rigid binding changes to the existing hand. No fake melee haft,
bones or actions are added. Removes enclosed original hand faces. Archer's
articulated draw hands are excluded. New shield rear handles are real connected
supports to the retained shield field, bound to its existing hand.
"""
import bpy,bmesh,json,pathlib,hashlib,numpy as np,sys,math
from mathutils import Vector,Matrix
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from pandaren_quality import Gear,material
import roster_atlas,types
SRC=ROOT/'assets/source/battle/pandaren-quality-roster-v7/peris-pandaren-army.blend'
OUT=ROOT/'assets/source/battle/pandaren-quality-roster-v8'
REPORT=ROOT/'artifacts/battle-preview/pandaren-quality-20261009/grip-fit-v8'
if OUT.exists():raise FileExistsError(str(OUT))
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();source_sha=sha(SRC)
bpy.ops.wm.open_mainfile(filepath=str(SRC),use_scripts=False);C=bpy.data.collections['PERIS_EXPORT'];parts=list(C.all_objects);rows=[]
def ids_group(o,name):
 g=o.vertex_groups.get(name)
 return {v.index for v in o.data.vertices if any(w.group==g.index and w.weight>.95 for w in v.groups)} if g else set()
def islands(o,ids):
 adj={i:set() for i in ids}
 for e in o.data.edges:
  a,b=e.vertices
  if a in ids and b in ids:adj[a].add(b);adj[b].add(a)
 pending=set(ids);result=[]
 while pending:
  todo=[pending.pop()];piece=[]
  while todo:
   i=todo.pop();piece.append(i)
   for j in adj[i]:
    if j in pending:pending.remove(j);todo.append(j)
  if len(piece)>=6:result.append(piece)
 return result
def stats(points,target):
 p=np.array([v[:] for v in points]);c=p.mean(0);vals,vec=np.linalg.eigh(np.cov(p.T));axis=Vector(vec[:,-1]);axis=axis if axis.z>=0 else -axis;c=Vector(c);closest=c+axis*(target-c).dot(axis);proj=(p-np.array(c))@np.array(axis);rad=np.linalg.norm((p-np.array(c))-np.outer(proj,np.array(axis)),axis=1)
 return axis,closest,float(np.ptp(proj)),rad
detail=bpy.data.collections.new('Panda fitted functional rear handles');bpy.context.scene.collection.children.link(detail);black=material('Original charcoal bear connected gripping glove',(.026,.025,.022));bronze=material('Original dark shield handle bracket',(.09,.065,.035),kind='metal',metal=.6)
for role in ['line_infantry','spear_guard','elite','scout','light_cavalry','heavy_cavalry']:
 meshes=[o for o in parts if o and o.type=='MESH' and o.get('peris_role')==role];arm=next(m.object for o in meshes for m in o.modifiers if m.type=='ARMATURE' and 'hand_R' in m.object.data.bones);rec={'role':role}
 # The original open source paddles lie inside the new rigid glove and must
 # not survive as bright disconnected planes. Keep mixed proximal wrist.
 removed=0
 for obj in meshes:
  if obj.get('peris_atlas_partition') in ('original-connected-bear-grip','original-bear-detail'):continue
  bm=bmesh.new();bm.from_mesh(obj.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in obj.vertex_groups};family={'hand_L','hand_R','finger_L','finger_R','fingertip_L','fingertip_R'}
  cut=[f for f in bm.faces if sum(sum(w for i,w in v[layer].items() if names.get(i) in family) for v in f.verts)/len(f.verts)>.64]
  removed+=len(cut);bmesh.ops.delete(bm,geom=cut,context='FACES');bm.to_mesh(obj.data);bm.free();obj.data.update()
 rec['enclosedOriginalHandFacesRemoved']=removed
 if role in ('line_infantry','spear_guard','elite','heavy_cavalry'):
  hand=arm.data.bones['hand_R'];inv=hand.matrix_local.inverted();target=Vector((0,.15,0));candidate=[]
  for obj in meshes:
   ids=ids_group(obj,'prop-weapon_R')
   if not ids:continue
   tr=inv@arm.matrix_world.inverted()@obj.matrix_world
   for piece in islands(obj,ids):
    pts=[tr@obj.data.vertices[i].co for i in piece];axis,center,length,rad=stats(pts,target);spread=float(np.quantile(rad,.9));uniform=float(np.std(rad))
    if role=='line_infantry':score=100 if len(piece)==24 and uniform<.00001 else 0
    else:score=length/(spread+.015)/(1+np.std(rad)*20) if .015<spread<.080 else 0
    candidate.append((score,obj,ids,piece,axis,center,length,rad))
  score,obj,ids,piece,axis,center,length,rad=max(candidate,key=lambda r:r[0]);tr=inv@arm.matrix_world.inverted()@obj.matrix_world;back=tr.inverted();rotation=axis.rotation_difference(Vector((0,0,1))).to_matrix()
  radius=float(max(rad))
  # Complete original weapon preserves all distances, texture UVs and tip.
  for i in ids:obj.data.vertices[i].co=back@(target+rotation@(tr@obj.data.vertices[i].co-center))
  handgroup=obj.vertex_groups.get('hand_R') or obj.vertex_groups.new(name='hand_R')
  for i in ids:
   for w in list(obj.data.vertices[i].groups):obj.vertex_groups[w.group].remove([i])
   handgroup.add([i],1,'REPLACE')
  obj.data.update();scale=(radius+.0012)/(.045+.0012)
  grip=next(o for o in meshes if o.get('peris_atlas_partition')=='original-connected-bear-grip');gtr=inv@arm.matrix_world.inverted()@grip.matrix_world;gback=gtr.inverted();gids=ids_group(grip,'hand_R');changed=0
  for i in gids:
   p=gtr@grip.data.vertices[i].co;t=max(0,min(1,(p.y+.025)/.10));t=t*t*(3-2*t)
   if t>0:
    p.x*=1+(scale-1)*t;p.y=.15+(p.y-.15)*(1+(scale-1)*t);grip.data.vertices[i].co=gback@p;changed+=1
  grip.data.update();rec['weaponFit']={'originalMesh':obj.name,'actualSourceIslandVertices':len(piece),'completeWeaponVerticesPreserved':len(ids),'originalCenterHandLocal':list(center),'originalAxisHandLocal':list(axis),'originalShaftLength':length,'actualShaftRadiusMax':radius,'newCenterHandLocal':list(target),'newAxisHandLocal':[0,0,1],'weaponReboundToExistingHand':'hand_R','shaftShapeUVTipLengthPreserved':True,'nearFingerRadialScale':scale,'modifiedGripVertices':changed,'wristProximalLocalYAtOrBelow':-.025}
 # Rear shield grasp: a genuine shaft through the existing palm is connected
 # by two brackets to the retained source field. Original field is untouched.
 if role in ('line_infantry','spear_guard','elite','heavy_cavalry'):
  hand=arm.data.bones['hand_L'];H=hand.matrix_local;center=H@Vector((0,.15,0));axis=H.to_3x3()@Vector((0,0,1));g=Gear(detail,arm,role)
  g.curve('functional dark rear shield handle',[center-axis*.12,center+axis*.12],.045,'hand_L',black,3,handles='VECTOR')
  shield=arm.data.bones['prop-shield'].matrix_local;anchors=[shield@Vector((-.11,.041,.12)),shield@Vector((.11,.041,.12))]
  for k in (0,1):g.curve('rear shield support bracket '+str(k),[anchors[k],center+axis*((-1 if k==0 else 1)*.12)],.016,'hand_L',bronze,3,handles='VECTOR')
  rec['shieldHandle']={'actualPalmCenterRest':list(center),'existingHandSocket':[0,.15,0],'handleRadius':.045,'fieldAnchorsRest':[list(v) for v in anchors],'retainedShieldFieldUnchanged':True,'newSupportBrackets':2,'sourceBackStrapsRetained':True}
 rows.append(rec);print('PANDA_FITTED_ROLE',role,flush=True)
OUT.mkdir(parents=True);lib=types.SimpleNamespace(collection=detail,groups={},PROFILE={'family':'egyptian'});roster_atlas.pack(lib,'pandaren',OUT/'textures/handles',size=512)
for o in list(detail.objects):detail.objects.unlink(o);C.objects.link(o)
bpy.data.collections.remove(detail)
for a in C.all_objects:
 if a and a.type=='ARMATURE':
  a.animation_data.action=None
  for t in a.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update();bpy.ops.file.pack_all();native=OUT/'peris-pandaren-army.blend';bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(SRC)!=source_sha:raise RuntimeError('Immutable source changed')
report={'edition':'pandaren-quality-roster-v8','source':{'path':str(SRC),'sha256':source_sha,'unchanged':True},'native':{'path':str(native),'sha256':sha(native)},'roles':rows,'archerArticulatedHandsUnchanged':True,'sourceBonesActionsRestBindUnchanged':True,'newBones':0,'finishedArtApproved':False,'runtimeApproved':False}
(OUT/'native-provenance.json').write_text(json.dumps(report,indent=2)+'\n');(REPORT/'fit-report.json').write_text(json.dumps(report,indent=2)+'\n');print('PANDA_FITTED_V8_NATIVE_READY',native,flush=True)
