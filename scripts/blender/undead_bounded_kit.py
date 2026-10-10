"""Original bounded grave-kit details on existing skeleton/animal rigs."""
import bpy,math
from mathutils import Vector
import undead_contact_v4 as shapes
from undead_portrait_quality import textured,helmet

def add_grave_kit(collection,detail):
 steel=textured('Undead fitted grave plate worn iron',(.14,.16,.18),'metal',.7,.78);trim=textured('Undead grave kit tarnished bound bronze',(.30,.205,.105),'metal',.6,.75);cloth=textured('Undead front folded frayed violet grave scarf',(.12,.065,.19),'cloth',0,.93);rows=[]
 for role in ['line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry','catapult']:
  meshes=[o for o in list(collection.all_objects) if o.type=='MESH' and o.get('peris_role')==role];arm=next(m.object for o in meshes for m in o.modifiers if m.type=='ARMATURE' and 'hand_R' in m.object.data.bones);neck=arm.data.bones['neck'].head_local;created=[]
  # A narrow front fold covers the disconnected collar opening while retaining
  # the rib silhouette and an open sternum below it. It shares the existing chest.
  points=[neck+Vector((-.27,-.13,-.055)),neck+Vector((-.15,-.215,-.085)),neck+Vector((0,-.235,-.15)),neck+Vector((.15,-.215,-.085)),neck+Vector((.27,-.13,-.055))]
  created.append(shapes.tube(role+' fitted front grave scarf fold',points,[.034,.039,.037,.039,.034],arm,role,'chest',cloth,detail))
  if role=='elite':created+=helmet(arm,role,steel,trim,detail,True)
  # Anatomical tibia/fibula stay visible at the sides and rear. Short convex
  # front plates add actual equipment volume without changing toes/supports.
  for side in ['L','R']:
   b=arm.data.bones['leg_'+side];direction=(b.tail_local-b.head_local).normalized();front=Vector((0,-1,0));front=(front-direction*front.dot(direction)).normalized();across=direction.cross(front).normalized();verts=[];n=9
   for wall in [0,1]:
    for r,t in enumerate([.16,.42,.70]):
     center=b.head_local.lerp(b.tail_local,t);radius=(.092 if role=='catapult' else .076)-wall*.013
     for i in range(n):angle=(i/(n-1)-.5)*1.65;verts.append(center+front*(math.cos(angle)*radius)+across*(math.sin(angle)*radius))
   faces=[];off=3*n
   for r in range(2):
    for i in range(n-1):a=r*n+i;faces.extend([(a,a+1,a+n+1,a+n),(a+off,a+n+off,a+n+1+off,a+1+off)])
   for row in [0,2]:
    for i in range(n-1):a=row*n+i;faces.append((a,a+off,a+1+off,a+1))
   for sideedge in [0,n-1]:
    for r in range(2):a=r*n+sideedge;faces.append((a,a+n,a+n+off,a+off))
   created.append(shapes.mesh(role+' shaped grave shin plate '+side,verts,faces,arm,role,[{b.name:1}]*len(verts),steel,detail))
   rim=[verts[i] for i in range(n)]+[verts[n-1+r*n] for r in range(1,3)]+[verts[2*n+i] for i in range(n-2,-1,-1)]+[verts[n]]+[verts[0]];created.append(shapes.tube(role+' rolled grave shin rim '+side,rim,[.007]*len(rim),arm,role,b.name,trim,detail))
  if role=='catapult':
   chest=arm.data.bones['chest'].head_local
   for s in [-1,1]:
    # Raised segmented collar plates leave the central rib cage open.
    for k in range(3):
     center=chest+Vector((s*(.18+k*.09),-.19,.23-k*.065));created.append(shapes.sphere(role+' dimensional grave collar plate '+str(s)+'-'+str(k),center,(.12,.045,.07),arm,role,'chest',steel,detail))
     created.append(shapes.sphere(role+' collar bronze stud '+str(s)+'-'+str(k),center+Vector((0,-.05,.005)),(.020,.009,.020),arm,role,'chest',trim,detail))
  for obj in created:obj['peris_atlas_partition']='original-undead-grave-kit'
  rows.append({'role':role,'newParts':len(created),'sourceSkullRibsHandsSupportFeetAndActionsPreserved':True})
 return rows
