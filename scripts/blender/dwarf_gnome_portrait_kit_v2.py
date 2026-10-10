"""Original bounded portrait kit overlays and explicit Gnome pony derivative.

Caller-owned unpacked editions only. Existing hand sockets and rig controls stay.
"""
import bpy,json,math
import numpy as np
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree
import dwarf_gnome_quality as q
from dwarf_gnome_shield_size import actual_standing_body_height

def _stud(name,c,r,arm,role,bone,mat,col):
 c=Vector(c);n=10;vs=[c+Vector((math.sin(i/n*math.tau)*r,0,math.cos(i/n*math.tau)*r)) for i in range(n)]+[c+Vector((0,-r*.35,0))];return q.mesh(name,vs,[(i,(i+1)%n,n) for i in range(n)],arm,role,bone,mat,col,smooth=False)

def clone_heavy_pony(col):
 old=[o for o in col.all_objects if o.get('peris_role')=='heavy_cavalry'];oldnames=[o.name for o in old];source=[o for o in col.all_objects if o.get('peris_role')=='light_cavalry'];mapping={}
 # Legacy source armatures have no peris_role tag. Follow actual modifiers
 # and parents so the new role owns its mount/rider rigs and actions too.
 source_rigs={m.object for o in source for m in o.modifiers if m.type=='ARMATURE'}
 for rig in list(source_rigs):
  parent=rig.parent
  while parent:
   if parent.type=='ARMATURE':source_rigs.add(parent)
   parent=parent.parent
 source+=list(source_rigs-set(source))
 old_rigs={m.object for o in old for m in o.modifiers if m.type=='ARMATURE'}
 for rig in old_rigs:
  if not any(o not in old and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers) for o in col.all_objects):old.append(rig)
 oldnames=[o.name for o in old]
 for o in source:
  copy=o.copy();copy.name=o.name.replace('light_cavalry','heavy_cavalry')+' pony';copy['peris_role']='heavy_cavalry'
  if o.data:copy.data=o.data.copy()
  col.objects.link(copy);mapping[o]=copy
 for original,copy in mapping.items():
  if original.parent:copy.parent=mapping.get(original.parent,original.parent)
  for mod in copy.modifiers:
   if mod.type=='ARMATURE':mod.object=mapping.get(mod.object,mod.object)
  if copy.type=='ARMATURE':
   for t in copy.animation_data.nla_tracks:
    t.name=t.name.replace('light_cavalry','heavy_cavalry')
    for s in t.strips:s.action=s.action.copy();s.action.name=s.action.name.replace('light_cavalry','heavy_cavalry')
   if copy.get('peris_dwarf_gnome_head_fit'):
    fit=json.loads(copy['peris_dwarf_gnome_head_fit']);fit['role']='heavy_cavalry';copy['peris_dwarf_gnome_head_fit']=json.dumps(fit)
   copy['peris_gnome_heavy_pony_derivative']='Copied existing credited fitted light war-pony body/rider/source controls and closed hand kit to replace mismatched boar; role-owned datablocks/actions copied. Original source bones/rest/socket geometry retained. Original heavy kit overlays follow afterward.'
 for o in old:bpy.data.objects.remove(o,do_unlink=True)
 return {'supersededHeavyBoarObjects':oldnames,'newRoleObjects':[o.name for o in mapping.values()],'sourceRole':'light_cavalry','sourceRestRigControlsClipsAndContactsCopied':True,'newRoleActionNamesDistinct':True}

def round_gnome_shield(col,role):
 oldfield=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and 'Convex thick portrait shield continuous field' in o.name);arm=oldfield.parent;basis=arm.data.bones['hand_L'].matrix_local;inv=basis.inverted();p=[inv@v.co for v in oldfield.data.vertices];n=(len(p)-2)//2;front=(p[0]-p[n+1]).normalized();up=(p[1]-p[17]).normalized();across=up.cross(front).normalized();center=(p[0]+p[n+1])*.5;standing=actual_standing_body_height(col,role,arm);radius=.60*standing['standingHeightRestLocal']*.5;c=Vector((0,.15,0));oldheight=max((v-c).dot(up) for v in p)-min((v-c).dot(up) for v in p)
 removed=[]
 for o in list(col.all_objects):
  if o.type=='MESH' and o.get('peris_role')==role and any(s in o.name for s in ['Convex thick portrait shield continuous field','Shield substantial exposed bent copper rim','Raised dimensional shield clan diamond','Shield real rear grip support bracket','Shield requested-height actual rear grip support']):removed.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
 field=q.material('Gnome portrait burgundy lacquer round shield',(.30,.035,.025),.12,.68,kind='leather');trim=q.material('Gnome original worn brass sun shield fittings',(.48,.31,.105),.83,.43);n=48;rim=[center+across*math.sin(i/n*math.tau)*radius+up*math.cos(i/n*math.tau)*radius for i in range(n)];vs=[basis@(center+front*.030)]+[basis@v for v in rim]+[basis@(center-front*.030)]+[basis@(v-front*.030) for v in rim];fs=[(0,i+1,(i+1)%n+1) for i in range(n)]+[(n+1,n+2+(i+1)%n,n+2+i) for i in range(n)]+[(i+1,(i+1)%n+1,n+2+(i+1)%n,n+2+i) for i in range(n)];q.mesh('Convex thick portrait shield continuous field',vs,fs,arm,role,'hand_L',field,col,smooth=True);q.curve('Shield substantial exposed bent copper rim',[basis@(v+front*.005) for v in rim+[rim[0]]],.018,arm,role,'hand_L',trim,col,10)
 for z in [-.15,.15]:q.curve('Shield requested-height actual rear grip support bracket',[basis@(c+Vector((0,0,z))),basis@(center+up*z-front*.030)],.014,arm,role,'hand_L',trim,col,10)
 # Closed raised boss with 12 separately shaped rays, not a flat decal.
 r=radius*.18;v=[basis@(center+front*.033+across*math.sin(i/24*math.tau)*r+up*math.cos(i/24*math.tau)*r) for i in range(24)]+[basis@(center+front*(.033+r*.45))];q.mesh('Gnome raised dimensional round sun boss',v,[(i,(i+1)%24,24) for i in range(24)],arm,role,'hand_L',trim,col,smooth=True)
 for i in range(12):
  a=i/12*math.tau;d=across*math.sin(a)+up*math.cos(a);t=across*math.cos(a)-up*math.sin(a);v=[basis@(center+front*.035+d*r*.9-t*r*.23),basis@(center+front*.035+d*r*1.85),basis@(center+front*.035+d*r*.9+t*r*.23),basis@(center+front*.052+d*r*1.2)];q.mesh('Gnome individually raised brass sun ray',v,[(0,1,3),(1,2,3),(2,0,3),(2,1,0)],arm,role,'hand_L',trim,col,smooth=False)
 for i in range(16):
  a=i/16*math.tau;point=center+front*.013+(across*math.sin(a)+up*math.cos(a))*radius*.91
  q.curve('Gnome seated round shield brass rivet',[basis@(point-front*.005),basis@(point+front*.010)],.011,arm,role,'hand_L',trim,col,10)
 return {'role':role,'roundDiameterRestLocal':radius*2,'bodyMeasurement':standing,'targetBodyRatio':.60,'priorOvalHeight':oldheight,'oldPartsRemoved':removed,'actualHandLFieldRimBossRearBracketsShaftAndGloveOneRigAttachment':True,'preservedClosedPalmSocket':[0,.15,0],'runtimeApproved':False}

def apply_portrait_kit(col,faction):
 rows=[];iron=q.material(faction+' original worked portrait helmet iron',(.22,.235,.25),.82,.56);trim=q.material(faction+' original exposed portrait brass rivets',(.48,.31,.105),.82,.42);cloth=q.material(faction+' original stitched maroon portrait garment',(.23,.040,.027),.02,.89,kind='leather')
 for role in ['line_infantry','spear_guard','elite','archer','scout','light_cavalry','heavy_cavalry']:
  head=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and str(o.get('peris_atlas_partition','')).startswith('licensed-'));arm=head.parent;fit=json.loads(arm['peris_dwarf_gnome_head_fit']);h=Vector((arm.data.bones['head'].head_local))+Vector((0,-.025,.18));operations=[]
  for o in col.all_objects:
   if o.type=='MESH' and o.get('peris_role')==role and 'Fitted continuous quilted under-vest' in o.name:o.data.materials[0]=cloth;operations.append('Maroon fitted quilted vest')
  lames=[o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and 'Overlapping forged portrait chest lame' in o.name]
  if lames:
   tree=BVHTree.FromPolygons([v.co for o in lames for v in o.data.vertices],[tuple(i+sum(len(p.data.vertices) for p in lames[:j]) for i in face.vertices) for j,o in enumerate(lames) for face in o.data.polygons]);lo=Vector([min(v.co[i] for o in lames for v in o.data.vertices) for i in range(3)]);hi=Vector([max(v.co[i] for o in lames for v in o.data.vertices) for i in range(3)])
   def at(x,z):
    p=tree.ray_cast(Vector((x,-3,z)),Vector((0,1,0)),6)[0]
    if p is None:return None
    p.y-=.008;return p
   for j,o in enumerate(lames):
    z=sum(v.co.z for v in o.data.vertices)/len(o.data.vertices)
    for x in [lo.x*.78,hi.x*.78]:
     p=at(x,z)
     if p:_stud('Armor individually seated brass plate rivet',p,.014,arm,role,'chest',trim,col)
   if faction=='gnome':
    for side in [-1,1]:
     pts=[]
     for t in np.linspace(.04,.96,21):
      p=at((lo.x*(1-t)+hi.x*t)*side,hi.z*(1-t)+lo.z*t)
      if p:pts.append(p)
     if len(pts)>3:q.curve('Gnome purposeful worked brass diagonal corslet lattice',pts,.014,arm,role,'chest',trim,col,8)
   operations.append('Actual ray-fitted plate rivets; Gnome diagonal brass lattice')
  if faction=='dwarf' and role not in ['archer','scout']:
   for side in [-1,1]:
    c=h+Vector((side*.225,-.07,.13));vs=[c+Vector((0,-.115,.045)),c+Vector((0,.075,.025)),c+Vector((side*.018,.06,-.13)),c+Vector((side*.020,-.070,-.14))];q.mesh('Dwarf portrait broad forged helmet cheek plate',vs,[(0,1,2,3)],arm,role,'prop-head',iron,col,smooth=False)
    for p in [vs[0],vs[1]]:_stud('Dwarf seated helmet cheek rivet',p+Vector((0,-.004,0)),.010,arm,role,'prop-head',trim,col)
   operations.append('Broad forged cheek plates and seated rivets')
  if faction=='dwarf' and role=='line_infantry':
   m=q._hand_space(arm,'R');c=Vector((0,.15,0));axial=((arm.matrix_world@arm.pose.bones['hand_R'].matrix).to_3x3()@Vector((0,0,1))).z
   if axial<0:m=m@Matrix.Translation(c)@Matrix.Rotation(math.pi,4,'X')@Matrix.Translation(-c)
   for y in [-.119,.119]:
    v=[m@(c+Vector((x,y,z))) for x,z in [(0,.935),(-.095,1.03),(0,1.13),(.095,1.03)]]+[m@(c+Vector((0,y+(-.014 if y<0 else .014),1.03)))];q.mesh('Dwarf raised diamond worked hammer face device',v,[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],arm,role,'hand_R',trim,col,smooth=False)
    for x,z in [(-.27,.96),(.27,.96),(-.27,1.11),(.27,1.11)]:
     q.curve('Dwarf hammer actual seated face rivet',[m@(c+Vector((x,y,z))),m@(c+Vector((x,y+(-.016 if y<0 else .016),z)))],.013,arm,role,'hand_R',trim,col,10)
   operations.append('Forged hammer raised double-sided diamond devices and8 seated rivets')
  if faction=='gnome':
   for side in [-1,1]:
    q.curve('Gnome fitted maroon cap sewn curved seam',[h+Vector((side*.15,-.18,.18)),h+Vector((side*.13,-.08,.41)),h+Vector((side*.05,.04,.47)),h+Vector((0,.14,.37))],.006,arm,role,'prop-head',cloth,col,8)
   if role=='elite':
    transform=Matrix(fit['transform']);inv=transform.inverted();source=[inv@v.co for v in head.data.vertices];tree=BVHTree.FromPolygons(source,[tuple(p.vertices) for p in head.data.polygons])
    for side in [-1,1]:
     vs=[]
     for x,z in [(side*.150,.875),(side*.220,.905),(side*.205,1.095),(side*.155,1.095)]:
      p=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)),4)[0]
      if p is None:raise ValueError('Elite faceguard missed credited actual cheek')
      p.y-=.006;vs.append(transform@p)
     q.mesh('Gnome elite fitted articulated engineer brass cheek mask',vs,[(0,1,2,3)],arm,role,'prop-head',trim,col,smooth=False)
    operations.append('Elite original fitted brass cheek faceguard leaves gaze/nose/beard open')
   if role not in ['archer','scout']:operations.append(round_gnome_shield(col,role))
  rows.append({'role':role,'boundedOriginalKit':operations,'sourceRigRestActionsHandSocketsUnchanged':True,'runtimeApproved':False,'finishedUnitApproved':False})
 return rows
