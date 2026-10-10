"""Original fitted narrow gaze and short warm beard on a credited source skull.

Caller-owned unpacked clones only; no source rig, UV or skull shape changes.
"""
import bpy,json,math
import numpy as np
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
import dwarf_gnome_quality as q

def apply_face(arm,role,col):
 head=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.get('peris_atlas_partition')=='licensed-gnome-head');transform=Matrix(json.loads(arm['peris_dwarf_gnome_head_fit'])['transform']);inv=transform.inverted();source=[inv@v.co for v in head.data.vertices];tree=BVHTree.FromPolygons(source,[tuple(p.vertices) for p in head.data.polygons])
 def hit(x,z):
  p=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)),4)[0]
  if p is None:raise ValueError(('Actual face ray miss',x,z))
  return p
 removed=[]
 for o in list(col.all_objects):
  if o.type=='MESH' and o.get('peris_role')==role and o.get('original_peris_equipment') and any(n in o.name for n in ['Gnome measured seated eye','Gnome actual orbital lid','Gnome fitted short individual beard strand','Gnome original fitted expressive eyebrow','Gnome refined embedded eye','Gnome source-connected flush orbital fold','Gnome fitted short expressive brow','Gnome fitted swept short beard lock']):removed.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
 # Source-coordinate finish keeps a rounded, feathered jaw boundary rather
 # than an opaque square beard. Colours are authored albedo, not light/shadow.
 mat=head.data.materials[0].copy();mat.name='Gnome revised warm skin and graduated chestnut beard';size=1024;yy,xx=np.mgrid[:size,:size];angle=(xx+.5)/size*math.tau-math.pi;z=.31+(yy+.5)/size*1.03;pixels=np.ones((size,size,4),np.float32);skin=np.asarray((.47,.31,.20));hair=np.asarray((.245,.135,.065));limit=.725+.065*np.abs(np.sin(angle));fade=np.clip((limit-z)/.07,0,1)*np.clip((1.25-np.abs(angle))/.24,0,1);grain=1+.10*np.sin(xx*.37+yy*.091);pixels[:,:,:3]=skin*(1-fade[:,:,None])+hair*grain[:,:,None]*fade[:,:,None];pixels[:,:,:3]*=(1+.008*np.sin(xx*.2+yy*.31))[:,:,None]
 tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');tex.image=q.image('Gnome revised original feathered chestnut beard source UV',pixels);head.data.materials[0]=mat
 eye=q.material('Gnome original narrow brown eye aperture',(.27,.225,.155),rough=.79,kind='eye');size=512;yy,xx=np.mgrid[:size,:size];r=np.sqrt(((xx+.5)/size-.5)**2*.056**2+((yy+.5)/size-.5)**2*.024**2);pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=(.27,.225,.155);pixels[r<.010,:3]=(.105,.048,.015);pixels[r<.0040,:3]=(.008,.006,.004);next(n for n in eye.node_tree.nodes if n.type=='TEX_IMAGE').image=q.image('Gnome fitted aperture iris original UV',pixels)
 hair=q.material('Gnome original readable chestnut hair locks',(.245,.135,.065),rough=.90,kind='hair');skinmat=q.material('Gnome original fitted lid skin',(.47,.31,.20),rough=.85,kind='skin')
 for side in [-1,1]:
  center=Vector((side*.105,0,.990));vs=[];uv=[];n=40
  points=[(0,0)]+[(math.sin(i/n*math.tau)*.028,math.cos(i/n*math.tau)*.012) for i in range(n)]
  for x,z in points:
   p=hit(center.x+x,center.z+z);p.y-=.0017;vs.append(transform@p);uv.append((.5+x/.056,.5+z/.024))
  o=q.mesh('Gnome fitted narrow continuous eye aperture '+str(side),vs,[(0,i+1,(i+1)%n+1) for i in range(n)],arm,role,'prop-head',eye,col,uv)
  for upper in [True,False]:
   pts=[]
   for t in np.linspace(-1,1,17):
    x=center.x+t*.029;z=center.z+(.012 if upper else -.011)*math.sqrt(max(0,1-t*t));p=hit(x,z);p.y-=.0008;pts.append(transform@p)
   q.curve('Gnome flush narrow anatomical lid '+str(side)+' '+str(upper),pts,.0018,arm,role,'prop-head',skinmat,col,8)
  pts=[]
  for i in range(9):
   x=side*(.070+.009*i);z=1.026+.003*math.sin(i/8*math.pi);p=hit(x,z);p.y+=.001;pts.append(transform@p)
  q.curve('Gnome seated chestnut eyebrow mass '+str(side),pts,.0038,arm,role,'prop-head',hair,col,8)
 # Fanned irregular short locks and a close moustache, anchored at actual jaw.
 for i in range(24):
  x=(i/23*2-1)*.147;top=.704+.040*abs(x/.147);pts=[];length=.075+.028*math.cos(i*.73)
  for j in range(6):
   t=j/5;p=hit(x*(1-.08*t)+.006*math.sin(t*math.pi+i*.5),top-length*t);p.y-=.002+.002*math.sin(t*math.pi);pts.append(transform@p)
  q.curve('Gnome fitted irregular short chestnut beard clump',pts,.0027,arm,role,'prop-head',hair,col,6)
 for side in [-1,1]:
  pts=[]
  for i in range(7):
   x=side*(.010+i*.008);z=.802-i*.002;p=hit(x,z);p.y-=.001;pts.append(transform@p)
  q.curve('Gnome fitted chestnut moustache',pts,.004,arm,role,'prop-head',hair,col,8)
 credit=json.loads(head['peris_component_credit']);credit['changes']+=' Original warm feathered chestnut beard albedo replaces previous dark jaw paint on same source UV. Narrow surface-fitted amber/brown gaze replaces protruding ellipsoid eyes; short seated brows, irregular beard locks and moustache are original Peris geometry. Source skull, UV, weights and rest rig unchanged.';head['peris_component_credit']=json.dumps(credit);arm['peris_licensed_head_credit']=json.dumps(credit)
 report={'role':role,'removedOldFaceParts':removed,'skullGeometryUvWeightsExact':True,'newGaze':'Narrow aperture conforms actual skull ray hits; front projection .0017 source units, no white protruding beads','hair':'Readable warm chestnut, feathered rounded albedo boundary;24 irregular short locks and actual seated moustache','runtimeApproved':False,'finishedUnitApproved':False};arm['peris_gnome_portrait_face_v2']=json.dumps(report);return report
