"""Original Peris Dwarf engineering kit on our credited 0 A.D. onager rig.

Operates only on a caller-owned duplicate. Source throwing, sling, release and
windlass bones/curves remain intact; four appended wheel controls roll in walk.
"""
import bpy,bmesh,json,math
from mathutils import Vector
import dwarf_gnome_quality as q

def _box(name,center,size,arm,bone,mat,col,bevel=.035):
 c=Vector(center);s=Vector(size)*.5;vs=[c+Vector((x*s.x,y*s.y,z*s.z)) for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
 o=q.mesh(name,vs,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],arm,'catapult',bone,mat,col,smooth=False)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.bevel(bm,geom=list(bm.edges),offset=min(bevel,min(size)*.2),segments=2,affect='EDGES');bm.to_mesh(o.data);bm.free();o.data.update();return o

def _gear(name,center,radius,thickness,arm,bone,mat,col,teeth=20):
 c=Vector(center);n=teeth*4;profile=[]
 for i in range(n):
  a=i/n*math.tau;r=radius*(1.08 if i%4 in [1,2] else .91);profile.append((r*math.sin(a),r*math.cos(a)))
 vs=[c+Vector((side*thickness*.5,y,z)) for side in [-1,1] for y,z in profile]
 fs=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 return q.mesh(name,vs,fs,arm,'catapult',bone,mat,col,smooth=False)

def _ring(name,center,radius,tube,arm,bone,mat,col):
 c=Vector(center);return q.curve(name,[c+Vector((0,math.sin(a)*radius,math.cos(a)*radius)) for a in [i/64*math.tau for i in range(65)]],tube,arm,'catapult',bone,mat,col,10)

def _wheel_bones(arm):
 centers={f'dwarf_wheel_{side}{end}':Vector((x,y,.82)) for side,x in [('L',-3.0),('R',3.0)] for end,y in [('F',-3.35),('B',3.35)]}
 bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for name,c in centers.items():
  if name in arm.data.edit_bones:raise ValueError('Preserve prior wheel edition')
  b=arm.data.edit_bones.new(name);b.head=c;b.tail=c+Vector((0,.35,0));b.parent=arm.data.edit_bones['onagermain'];b.use_connect=False
 bpy.ops.object.mode_set(mode='OBJECT')
 for name in centers:arm.pose.bones[name].rotation_mode='QUATERNION'
 for track in arm.animation_data.nla_tracks:
  strip=track.strips[0];action=strip.action.copy();strip.action=action
  for name in centers:
   path=f'pose.bones["{name}"].rotation_quaternion';curves=[action.fcurves.new(data_path=path,index=i) for i in range(4)]
   for i in range(49):
    frame=1+i*.5;angle=-(frame-1)/24*math.tau*2 if track.name.endswith('_walk') else 0;values=[math.cos(angle*.5),math.sin(angle*.5),0,0]
    for curve,value in zip(curves,values):curve.keyframe_points.insert(frame,value).interpolation='LINEAR'
 return centers

def apply_mechanical_catapult(col):
 arm=next(o for o in col.all_objects if o.type=='ARMATURE' and o.get('peris_role')=='catapult' and not o.parent)
 for name in ['onagermain','windlass','spoke','sling','prop_projectile']:
  if name not in arm.data.bones:raise ValueError('Require exact licensed mechanical foundation')
 before={b.name:[list(row) for row in b.matrix_local] for b in arm.data.bones};iron=q.material('Dwarf siege worked slate iron',(.27,.295,.32),.82,.58);brass=q.material('Dwarf siege worked brass edge hardware',(.49,.31,.13),.80,.44);wood=q.material('Dwarf siege warm iron-braced ash timber',(.34,.17,.071),.02,.88,kind='wood');rope=q.material('Dwarf siege dense torsion cord bundles',(.34,.27,.17),0,.95,kind='rope')
 # Reinforced chassis stays outside the central moving arm/sling corridor.
 for x in [-2.65,2.65]:
  _box('Dwarf catapult longitudinal braced timber rail',(x,.1,.63),(.42,8.55,.48),arm,'onagermain',wood,col,.055)
  for y in [-3.8,-1.6,.9,3.65]:
   _box('Dwarf catapult heavy iron rail binding',(x,y,.65),(.49,.17,.57),arm,'onagermain',iron,col,.018)
   for z in [.53,.78]:_box('Dwarf catapult seated brass rail bolt',(x+(.27 if x>0 else -.27),y,z),(.06,.10,.10),arm,'onagermain',brass,col,.012)
 for y in [-4.02,4.15]:_box('Dwarf catapult cross-frame heavy iron brace',(0,y,.69),(5.5,.25,.42),arm,'onagermain',iron,col,.035)
 for side in [-1,1]:
  # Metal bearing housings surround the actual original spoke pivot.
  c=Vector((side*1.75,0,.78748));_gear('Dwarf catapult seated torsion bearing gear',c,.65,.14,arm,'onagermain',brass,col,24);_ring('Dwarf catapult iron torsion gear outer rim',c,.72,.075,arm,'onagermain',iron,col)
  for i in range(9):
   off=(i-4)*.075;q.curve('Dwarf catapult dense visible torsion strand',[Vector((side*.38,-.40+off,.77)),Vector((side*1.70,-.32+off,.85)),Vector((side*2.4,-.20+off,.77))],.038,arm,'catapult','onagermain',rope,col,8)
  c=Vector((side*1.5,4.28964,1.48273));_gear('Dwarf catapult working windlass reduction gear',c,.56,.13,arm,'windlass',brass,col,20);_ring('Dwarf catapult working windlass iron binding',c,.28,.055,arm,'windlass',iron,col)
  q.curve('Dwarf catapult source-windlass crank handle',[c+Vector((side*.14,0,0)),c+Vector((side*.28,0,.75)),c+Vector((side*.58,0,.75))],.065,arm,'catapult','windlass',iron,col,12)
 # Added weight and copper collars follow the exact original throwing bone.
 _box('Dwarf catapult heavy laminated throwing arm',(0,2.65,1.12),(.54,5.25,.42),arm,'spoke',wood,col,.05)
 for y in [.65,1.65,2.70,3.70,4.65]:_box('Dwarf catapult throwing-arm iron binding',(0,y,1.12),(.61,.17,.49),arm,'spoke',iron,col,.025)
 _box('Dwarf catapult raised throwing-arm brass rune',(0,3.1,1.37),(.25,.75,.065),arm,'spoke',brass,col,.018)
 centers=_wheel_bones(arm)
 for name,c in centers.items():
  _gear('Dwarf catapult iron-banded timber road wheel',c,.82,.28,arm,name,wood,col,16)
  for side in [-1,1]:_ring('Dwarf catapult substantial road-wheel iron rim',c+Vector((side*.17,0,0)),.81,.085,arm,name,iron,col)
  _gear('Dwarf catapult brass wheel hub',c,.24,.40,arm,name,brass,col,12)
  for i in range(8):
   a=i/8*math.tau;end=c+Vector((0,math.sin(a)*.64,math.cos(a)*.64));q.curve('Dwarf catapult working iron wheel spoke',[c,end],.055,arm,'catapult',name,iron,col,8)
 if any(before[name]!=[list(row) for row in arm.data.bones[name].matrix_local] for name in before):raise ValueError('Original mechanical rig rest changed')
 report={'role':'catapult','identity':'Advanced Dwarf iron-braced timber torsion catapult; licensed onager foundation plus original Peris visible engineering','originalRigBonesExact':list(before),'newRollingWheelControls':list(centers),'originalThrowSlingWindlassAndReleaseCurvesUnchanged':True,'newWheelChannelsOnly':'Walk two revolutions per one-second source loop; idle/attack identity. Native49halfstep quaternion keys.','movingArmBindings':'Heavy arm and collars rigid spoke; crank/reduction gears rigid windlass; source projectile/sling retained.','requiresFullPoseClearanceReview':True,'runtimeApproved':False,'finishedUnitApproved':False};arm['peris_dwarf_engineering_siege']=json.dumps(report);return report
