"""Bounded head-only refinement on copied credited Gnome surfaces."""
import bpy,json,math
import numpy as np
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
import dwarf_gnome_quality as q

def apply_face(arm,role,col):
 heads=[o for o in col.all_objects if o.type=='MESH' and o.get('peris_role')==role and o.get('peris_atlas_partition')=='licensed-gnome-head']
 if len(heads)!=1:raise ValueError('Require isolated credited source skull')
 head=heads[0];fit=json.loads(arm['peris_dwarf_gnome_head_fit']);transform=Matrix(fit['transform']);inv=transform.inverted();source=[inv@v.co for v in head.data.vertices]
 # A shallow genuine orbital recess on the existing connected skull, without
 # relocating the big nose, ears, jaw or UVs. Source had no detailed normal map.
 for v,p in zip(head.data.vertices,source):
  frontness=max(0,min(1,(-p.y-.05)/.20));field=sum(math.exp(-((p.x-side*.105)/.062)**2-((p.z-.990)/.044)**2) for side in [-1,1]);p.y+=.014*field*frontness;v.co=transform@p
 head.data.normals_split_custom_set([(0,0,0)]*len(head.data.loops));head.data.update()
 tree=BVHTree.FromPolygons(source,[tuple(p.vertices) for p in head.data.polygons])
 def hit(x,z):
  p=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)),4)[0]
  if p is None:raise ValueError('Gnome source face ray missed')
  return p
 names=['Gnome measured seated eye','Gnome actual orbital lid','Gnome fitted short individual beard strand','Gnome original fitted expressive eyebrow']
 removed=[]
 for o in list(col.all_objects):
  if o.type=='MESH' and o.get('peris_role')==role and o.get('original_peris_equipment') and any(n in o.name for n in names):removed.append(o.name);bpy.data.objects.remove(o,do_unlink=True)
 mat=q._MATERIALS.get('gnome refined source skin',head.data.materials[0])
 if not mat.get('peris_gnome_face_surface_refined'):
  mat=mat.copy();mat.name='Gnome warm fitted skin with feathered short beard';size=1024;yy,xx=np.mgrid[:size,:size];angle=(xx+.5)/size*math.tau-math.pi;z=.31+(yy+.5)/size*1.03;shade=1+.012*np.sin(xx*.27+yy*.19);pixels=np.ones((size,size,4),np.float32);skin=np.asarray((.47,.31,.20));hair=np.asarray((.115,.063,.027));limit=.71+.055*np.abs(np.sin(angle));fade=np.clip((limit-z)/.037,0,1)*np.clip((1.25-np.abs(angle))/.10,0,1);grain=1+.075*np.sin(xx*.43+yy*.061);pixels[:,:,:3]=skin*(1-fade[:,:,None])+hair*grain[:,:,None]*fade[:,:,None];pixels[:,:,:3]*=shade[:,:,None]
  tex=next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE');tex.image=q.image('Gnome feathered beard original source UV albedo',pixels);mat['peris_gnome_face_surface_refined']=True;q._MATERIALS['gnome refined source skin']=mat
 head.data.materials[0]=mat
 skin=q.material('Gnome face fitted orbital skin',(.47,.31,.20),rough=.82,kind='skin');hair=q.material('Gnome face original warm brown beard',(.115,.063,.027),rough=.93,kind='hair');eye=q.material('Gnome face seated brown iris',(.31,.26,.18),rough=.64,kind='eye')
 if not eye.get('painted_iris'):
  size=512;yy,xx=np.mgrid[:size,:size];u=(xx+.5)/size;v=(yy+.5)/size;r=np.sqrt(((u-.5)*math.tau)**2+((v-.5)*math.pi)**2);pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=(.31,.26,.18);pixels[r<.47,:3]=(.12,.057,.016);pixels[r<.18,:3]=(.008,.006,.004);tex=next(n for n in eye.node_tree.nodes if n.type=='TEX_IMAGE');tex.image=q.image('Gnome deliberate seated brown iris UV',pixels);eye['painted_iris']=True
 for side in [-1,1]:
  center=hit(side*.105,.990)+Vector((0,.005,0));vs=[];fs=[];uv=[];n=32;rings=17
  for j in range(rings):
   lat=-math.pi/2+j/(rings-1)*math.pi
   for i in range(n):
    a=(i/n-.5)*math.tau;vs.append(transform@(center+Vector((math.sin(a)*math.cos(lat)*.046,-math.cos(a)*math.cos(lat)*.028,math.sin(lat)*.026))));uv.append((i/n,j/(rings-1)))
  for j in range(rings-1):
   for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
  q.mesh('Gnome refined embedded eye '+str(side),vs,fs,arm,role,'prop-head',eye,col,uv)
  for upper in [True,False]:
   inner=[];outer=[]
   for t in np.linspace(-1,1,25):
    x=side*.105+t*.046;dz=(.015 if upper else -.014)*(1-t*t)+side*t*.002;ip=center+Vector((t*.046,-.0075,dz));op=hit(x,.990+dz+(.010 if upper else -.010))+Vector((0,-.002,0));inner.append(transform@ip);outer.append(transform@op)
   faces=[(i,i+1,26+i,25+i) if upper else (25+i,26+i,i+1,i) for i in range(24)]
   q.mesh('Gnome source-connected flush orbital fold '+str(side)+' '+str(upper),inner+outer,faces,arm,role,'prop-head',skin,col)
  points=[hit(side*(.065+.014*i),1.036+.007*math.sin(i/6*math.pi))+Vector((0,-.004,0)) for i in range(7)];q.curve('Gnome fitted short expressive brow',list(map(lambda p:transform@p,points)),.0045,arm,role,'prop-head',hair,col,8)
 # Short curved locks meet the jaw surface. They supplement the feathered
 # albedo rather than an opaque rectangular mask or a source wig fragment.
 for i in range(42):
  x=(i/41*2-1)*.147;top=.685+.05*abs(x/.147);points=[]
  for j in range(5):
   z=top-j*.026;p=hit(x*(1-j*.018),z);p.y-=.003+.0025*math.sin(j/4*math.pi);p.x+=.002*math.sin(j*.9+i);points.append(transform@p)
  q.curve('Gnome fitted swept short beard lock',points,.0029,arm,role,'prop-head',hair,col,6)
 credit=json.loads(head['peris_component_credit']);credit['changes']+=' Bounded original orbital recession and connected lid folds; derived smooth normals recomputed after surface adaptation (not unchanged custom normals). Original feathered short-beard albedo on retained UV, original seated brown eyes and curved short locks; no directional shadow paint.';head['peris_component_credit']=json.dumps(credit);arm['peris_licensed_head_credit']=json.dumps(credit)
 report={'role':role,'removedSupersededOriginalFaceParts':removed,'licensedSurface':'Same source skull/nose, preserved UV and rig/weights; shallow .014 source-unit orbital recess, recomputed smooth normals','eyes':'Mostly embedded actual ellipsoids with brown iris texture and source-connected wider lid folds','beard':'Feathered warm brown source-UV finish and42 fine curved locks; source floor-length wig excluded','runtimeApproved':False,'finishedUnitApproved':False};arm['peris_gnome_portrait_face_refinement']=json.dumps(report);return report
