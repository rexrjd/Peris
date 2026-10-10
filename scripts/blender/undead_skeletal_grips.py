"""Original bony grasps fitted to measured source shafts; existing rigs only."""
import bpy,bmesh,numpy as np
from mathutils import Vector
import undead_contact_v4 as shapes

def shaft(source,arm,groupname,bone):
 group=source.vertex_groups.get(groupname)
 if not group:raise ValueError('No measured weapon group '+groupname)
 ids={v.index for v in source.data.vertices if any(g.group==group.index and g.weight>.99 for g in v.groups)}
 if not ids:raise ValueError('Empty measured weapon group '+groupname)
 adjacency={i:set() for i in ids}
 for e in source.data.edges:
  a,b=e.vertices
  if a in ids and b in ids:adjacency[a].add(b);adjacency[b].add(a)
 islands=[];remaining=set(ids);target=bone.matrix_local@Vector((0,.115,0))
 while remaining:
  pending=[remaining.pop()];island=[]
  while pending:
   i=pending.pop();island.append(i)
   for j in adjacency[i]:
    if j in remaining:remaining.remove(j);pending.append(j)
  if len(island)<6:continue
  points=np.array([source.data.vertices[i].co[:] for i in island]);center=points.mean(axis=0);values,vectors=np.linalg.eigh(np.cov(points.T));axis=Vector(vectors[:,-1]);c=Vector(center);closest=c+axis*(target-c).dot(axis);length=np.ptp((points-center)@vectors[:,-1]);width=np.sqrt(max(values[-2],1e-10));score=length/(width+.014)/((closest-target).length+.16)
  radial=np.linalg.norm((points-center)-np.outer((points-center)@vectors[:,-1],vectors[:,-1]),axis=1);radius=max(.012,min(.055,float(np.quantile(radial,.35))))
  islands.append((score,island,c,axis,closest,radius,length))
 if not islands:raise ValueError('No source shaft primitive')
 score,island,c,axis,closest,radius,length=max(islands,key=lambda row:row[0]);return ids,axis,closest,radius,{'group':groupname,'candidateVertices':len(island),'axisRest':list(axis),'radiusApprox':radius,'lengthApprox':float(length),'originalHandLineDistance':(target-closest).length}

def remove_open_hand(source,arm,side,exclude=()):
 group=source.vertex_groups['hand_'+side];inverse=arm.data.bones['hand_'+side].matrix_local.inverted();bm=bmesh.new();bm.from_mesh(source.data);layer=bm.verts.layers.deform.active;remove=[]
 for v in bm.verts:
  p=inverse@v.co
  if v.index not in exclude and v[layer].get(group.index,0)>.99 and -.14<p.x<.14 and -.055<p.y<.27 and abs(p.z)<.16:remove.append(v)
 count=len(remove);bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(source.data);bm.free();source.data.update();return count

def bones(arm,role,side,center,axis,radius,mat,col,pinch=False):
 hand=arm.data.bones['hand_'+side];hm=hand.matrix_local;axis=axis.normalized();u=axis.cross((hm.to_3x3()@Vector((0,1,0))).normalized()).normalized()
 if u.length<.1:u=axis.cross(Vector((1,0,0))).normalized()
 v=axis.cross(u).normalized();parts=[];width=.035 if pinch else .039;ring=radius+(.011 if pinch else .014)+.0025
 wrist=hm@Vector((0,.010,0));carpal=hm@Vector((0,.045,0))
 for j in range(3):parts.append(shapes.sphere(role+' '+side+' small carpal bone '+str(j),carpal+axis*(j-1)*.027,(.018,.017,.016),arm,role,hand.name,mat,col))
 for digit in range(4):
  along=(digit-1.5)*width;last=1.72 if digit==0 else 2.32 if digit<3 else 2.16;angles=[-.82,.19,1.20,last];points=[center+axis*along+(u*np.cos(t)+v*np.sin(t))*ring for t in angles];root=wrist+axis*along*.55
  parts.append(shapes.tube(role+' '+side+' metacarpal '+str(digit),[root,carpal+axis*along*.74,points[0]],[.011,.012,.011],arm,role,hand.name,mat,col))
  for segment in range(3):
   start,end=points[segment],points[segment+1];d=end-start;rad=[.011,.010,.0075][segment]*(.88 if digit==0 else 1)
   parts.append(shapes.tube(role+' '+side+' finger '+str(digit)+' phalanx '+str(segment),[start,start+d*.22,start+d*.77,end],[rad*1.04,rad*.85,rad*.76,rad*.94],arm,role,hand.name,mat,col))
   if segment<2:parts.append(shapes.sphere(role+' '+side+' finger knuckle '+str(digit)+'-'+str(segment),end,(rad*1.23,)*3,arm,role,hand.name,mat,col))
 thumb=[wrist+u*.044,center-u*(radius+.038)-axis*.064,center-u*ring+v*ring*.46-axis*.034]
 for i in range(2):parts.append(shapes.tube(role+' '+side+' opposing thumb phalanx '+str(i),[thumb[i],thumb[i].lerp(thumb[i+1],.5),thumb[i+1]],[.014,.012,.010],arm,role,hand.name,mat,col))
 parts.append(shapes.sphere(role+' '+side+' thumb knuckle',thumb[1],(.017,)*3,arm,role,hand.name,mat,col));return parts

def apply(source,arm,role,mat,leather,col,steel=None):
 created=[];reports=[]
 if role!='line_infantry':
  hand=arm.data.bones['hand_R'];target=hand.matrix_local@Vector((0,.115,0));authored=role in ['scout','light_cavalry']
  if authored:
   ids=set();center=target;axis=(arm.data.bones['prop-weapon_R'].matrix_local.to_3x3()@Vector((0,0,1))).normalized();radius=.024;metric={'mode':'original authored held javelin' if role=='scout' else 'original authored held cavalry lance','axisRest':list(axis),'radiusApprox':radius,'originalHandLineDistance':0}
   length=1.35 if role=='scout' else 1.85;created.append(shapes.tube(role+' measured held dark shaft',[center-axis*.54,center+axis*length],[radius,radius*.78],arm,role,'hand_R',leather,col));tip=center+axis*length;u=axis.cross(Vector((1,0,0))).normalized()
   if u.length<.1:u=axis.cross(Vector((0,1,0))).normalized()
   v=axis.cross(u);verts=[tip-u*.07,tip+v*.020,tip+u*.07,tip-v*.020,tip+axis*.32];created.append(shapes.mesh(role+' forged leaf spear point',verts,[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(0,3,2,1)],arm,role,[{'hand_R':1}]*5,steel or mat,col))
  else:ids,axis,center,radius,metric=shaft(source,arm,'prop-weapon_R',hand)
  delta=target-center
  # The arrow retains its independent source release channels. All held melee
  # shafts/javelins instead follow the same rigid hand as their new fingers.
  if role!='archer' and not authored:
   group=source.vertex_groups['hand_R']
   for i in ids:
    source.data.vertices[i].co+=delta
    for g in list(source.data.vertices[i].groups):source.vertex_groups[g.group].remove([i])
    group.add([i],1,'REPLACE')
   center=target
  removed=remove_open_hand(source,arm,'R',ids);created+=bones(arm,role,'R',center,axis,radius,mat,col,role=='archer');metric.update({'side':'R','removedOpenHandVertices':removed,'shaftVertexCountPreserved':len(ids),'shaftRestTranslation':list(delta) if role!='archer' else [0,0,0],'shaftReboundToHand':role!='archer','graspCenterRest':list(center),'pinch':role=='archer','authoredNewWeapon':authored});reports.append(metric)
 # Shield hands receive a real straight central leather grip; archer's left
 # hand follows the measured bow hilt without moving source bow geometry.
 if role!='scout':
  hand=arm.data.bones['hand_L'];center=hand.matrix_local@Vector((0,.11,0));axis=hand.matrix_local.to_3x3()@Vector((0,0,1));radius=.018;metric={'side':'L','mode':'shield handle'}
  if role=='archer':
   ids,axis,center,radius,metric=shaft(source,arm,'prop-weapon_bow',hand);metric['mode']='measured bow hilt'
  else:
   old=next((o for o in col.all_objects if o.name==role+' shield leather hand grip'),None)
   if old:bpy.data.objects.remove(old,do_unlink=True)
   m=arm.data.bones['prop-shield'].matrix_local;ends=[m@Vector((-.11,.041,.12)),m@Vector((.11,.041,.12))]
   created.append(shapes.tube(role+' straight central shield leather grip',[ends[0],center-axis*.10,center+axis*.10,ends[1]],[.018]*4,arm,role,'hand_L',leather,col))
  removed=remove_open_hand(source,arm,'L');created+=bones(arm,role,'L',center,axis,radius,mat,col);metric.update({'removedOpenHandVertices':removed,'graspCenterRest':list(center),'shaftReboundToHand':False});reports.append(metric)
 else:
  hand=arm.data.bones['hand_L'];ids,axis,center,radius,metric=shaft(source,arm,'prop-ammo',hand);target=hand.matrix_local@Vector((0,.115,0));delta=target-center;group=source.vertex_groups['hand_L']
  for i in ids:
   source.data.vertices[i].co+=delta
   for g in list(source.data.vertices[i].groups):source.vertex_groups[g.group].remove([i])
   group.add([i],1,'REPLACE')
  removed=remove_open_hand(source,arm,'L',ids);created+=bones(arm,role,'L',target,axis,radius+.026,mat,col);metric.update({'side':'L','mode':'three source spare javelins bundle','removedOpenHandVertices':removed,'shaftRestTranslation':list(delta),'shaftReboundToHand':True,'graspCenterRest':list(target)});reports.append(metric)
 return created,reports
