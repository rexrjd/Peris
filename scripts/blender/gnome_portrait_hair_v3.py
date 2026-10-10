"""Original shaped engineer brows, moustache and connected layered beard."""
import bpy,json,math
import numpy as np
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
import dwarf_gnome_quality as q

def apply_hair(col,role):
 head=next(o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.get('peris_atlas_partition')=='licensed-gnome-head');arm=head.parent;T=Matrix(json.loads(arm['peris_dwarf_gnome_head_fit'])['transform']);I=T.inverted();tree=BVHTree.FromPolygons([I@v.co for v in head.data.vertices],[tuple(p.vertices) for p in head.data.polygons]);removed=[]
 for o in list(col.all_objects):
  if o.type=='MESH' and o.get('peris_role')==role and any(t in o.name for t in ['seated chestnut eyebrow mass','fitted irregular short chestnut beard clump','fitted chestnut moustache']):removed.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
 def hit(x,z):
  p=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)),4)[0]
  if p is None:raise ValueError(('Actual hair anchor miss',x,z))
  return p
 hair=q.material('Gnome original dense worked chestnut engineer hair',(.090,.034,.009),rough=.89,kind='hair');size=256;yy,xx=np.mgrid[:size,:size];height=.010*np.sin(xx*.28+np.sin(yy*.035))+.004*np.sin(xx*.9+yy*.045);dy,dx=np.gradient(height);normal=np.stack((-dx*20,-dy*20,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True);pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=normal*.5+.5;tex=hair.node_tree.nodes.new('ShaderNodeTexImage');tex.image=q.image('Gnome original fine hair strand tangent relief',pixels,True);node=hair.node_tree.nodes.new('ShaderNodeNormalMap');hair.node_tree.links.new(tex.outputs['Color'],node.inputs['Color']);hair.node_tree.links.new(node.outputs['Normal'],hair.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
 def tuft(name,centers,widths,depths):
  n=10;vs=[];fs=[]
  for j,(c,w,d) in enumerate(zip(centers,widths,depths)):
   tangent=centers[min(j+1,len(centers)-1)]-centers[max(j-1,0)];vertical=Vector((-tangent.z,0,tangent.x)).normalized()
   for i in range(n):
    a=i/n*math.tau;vs.append(T@(c+vertical*math.sin(a)*w+Vector((0,-math.cos(a)*d,0))))
  for j in range(len(centers)-1):
   for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  fs.extend([tuple(range(n-1,-1,-1)),tuple(range((len(centers)-1)*n,len(centers)*n))]);return q.mesh(name,vs,fs,arm,role,'prop-head',hair,col)
 for side in [-1,1]:
  pts=[]
  for t in np.linspace(0,1,11):
   p=hit(side*(.058+.090*t),1.023+.022*t+.005*math.sin(t*math.pi));p.y-=.002;pts.append(p)
  tuft('Gnome broad tapered serious engineer brow',pts,[.002+.010*math.sin(i/10*math.pi)**.7 for i in range(11)],[.002+.004*math.sin(i/10*math.pi) for i in range(11)])
  pts=[]
  for t in np.linspace(0,1,12):
   p=hit(side*(.012+.085*t),.780-.034*t-.009*math.sin(t*math.pi));p.y-=.006;pts.append(p)
  tuft('Gnome thick curved seated engineer moustache',pts,[.002+.012*math.sin(i/11*math.pi)**.6 for i in range(12)],[.002+.010*math.sin(i/11*math.pi) for i in range(12)])
 # A single continuous beard shell, with a genuinely rounded lower outline.
 cols=25;rows=17;vs=[];fs=[]
 for j in range(rows):
  t=j/(rows-1)
  for i in range(cols):
   u=i/(cols-1)*2-1;x=.151*u*(1-.12*t);top=.747+.040*abs(u);bottom=.536+.055*u*u;z=top*(1-t)+bottom*t;p=hit(x,z);p.y-=.005+.016*math.sin(math.pi*t)*max(0,1-u*u);vs.append(T@p)
 for j in range(rows-1):
  for i in range(cols-1):fs.append((j*cols+i,j*cols+i+1,(j+1)*cols+i+1,(j+1)*cols+i))
 q.mesh('Gnome original connected layered rounded beard mass',vs,fs,arm,role,'prop-head',hair,col)
 for i in range(12):
  x=(i/11*2-1)*.125;pts=[]
  for j in range(6):
   t=j/5;p=hit(x*(1-.09*t),.700+.035*abs(x/.125)-t*.105);p.y-=.016+.005*math.sin(t*math.pi);pts.append(p)
  tuft('Gnome dense overlapping tapered short beard lock',pts,[.004+.007*math.sin(j/5*math.pi) for j in range(6)],[.002+.005*math.sin(j/5*math.pi) for j in range(6)])
 return {'role':role,'removedThinBarAndWhiskerParts':removed,'hair':'Original broad tapering brows, two curved volumetric moustache sides, one continuous ray-fitted rounded beard shell and12 overlapping tapered locks; original authored tangent strand relief','sourceSkullUvWeightsRigActionsUnchanged':True,'runtimeApproved':False,'finishedUnitApproved':False}
