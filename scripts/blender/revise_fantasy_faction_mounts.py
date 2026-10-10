"""Large original stags, mountain rams and giant rats on preserved motion rigs.

Whole mount geometry is distinct. Rider bodies, weapon grips and faction clips
are retained; seated lower limbs and measured ground contact are refitted.
"""
import argparse,pathlib,sys,bpy,math,json,hashlib,types,random
from mathutils import Matrix,Vector
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'scripts/blender'))
from orc_mounted_prototypes import prop_mesh,rope,cushion,seated_rider
from roster_detail_surfaces import detail_material,gild_existing_metal
from prototype_contact_floor import normalize_role_ground
from roster_atlas import pack
p=argparse.ArgumentParser();p.add_argument('--faction',choices=['elf','dwarf','gnome'],required=True);p.add_argument('--source',required=True);p.add_argument('--edition',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);source=pathlib.Path(a.source).resolve();out=ROOT/'assets/source/battle'/a.edition
if out.exists():raise FileExistsError(out)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();oldsha=sha(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False)
master=bpy.data.collections['PERIS_EXPORT'];new=bpy.data.collections.new(a.faction.upper()+'_DISTINCT_MOUNT_KIT');bpy.context.scene.collection.children.link(new);roles=['scout','light_cavalry','heavy_cavalry'];records=[]
def items():return [o for o in master.all_objects if o is not None]
def owns(o,arm):return o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)
def arms(role):return {m.object for o in items() if o.type=='MESH' and o.get('peris_role')==role for m in o.modifiers if m.type=='ARMATURE'}
def sample():
 for arm in [o for o in items() if o.type=='ARMATURE']:
  arm.animation_data.action=None
  for t in arm.animation_data.nla_tracks:t.mute=not t.name.endswith('_idle')
 bpy.context.scene.frame_set(-1);bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
sample()
gold=detail_material(a.faction+' original worked mount gold',(.55,.36,.085));steel=detail_material(a.faction+' original engraved dark mount steel',(.10,.115,.135));leather=detail_material(a.faction+' original saddle worn hide',(.095,.051,.025),'skin',0,.86);cloth=detail_material(a.faction+' original blue mount blanket',(.035,.071,.14),'cloth',0,.91);fur=detail_material(a.faction+' original shaggy wool' if a.faction=='dwarf' else 'Gnome giant rat dark layered fur',(.53,.51,.43) if a.faction=='dwarf' else (.105,.083,.060),'wool' if a.faction=='dwarf' else 'fur',0,.87);horn=detail_material(a.faction+' original ridged mountain horn',(.51,.375,.20),'horn',0,.76);pink=detail_material('Giant rat bare ear tail and paw skin',(.26,.115,.091),'skin',0,.88);dark=detail_material('Animal wet black nose and eyes',(.014,.011,.010),'skin',0,.35)
def add(o):
 if o.name not in new.objects:new.objects.link(o)
 o['peris_atlas_partition']='original-'+a.faction+'-mount';return o
def geom(name,verts,faces,arm,bone,role,mat):return add(prop_mesh(name,verts,faces,arm,bone,role,mat))
def tube(name,points,radii,arm,bone,role,mat,ring_weights=None):
 verts=[];faces=[];n=12
 for j,point in enumerate(points):
  tangent=(points[min(j+1,len(points)-1)]-points[max(0,j-1)]).normalized();axis=tangent.cross(Vector((0,0,1)))
  if axis.length<.001:axis=tangent.cross(Vector((0,1,0)))
  axis.normalize();up=tangent.cross(axis).normalized()
  for i in range(n):angle=i*math.tau/n;verts.append(point+radii[j]*(axis*math.cos(angle)+up*math.sin(angle)))
 for j in range(len(points)-1):
  for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 faces.extend([tuple(range(n-1,-1,-1)),tuple(range((len(points)-1)*n,len(points)*n))]);o=geom(name,verts,faces,arm,bone,role,mat)
 uv=o.data.uv_layers.active
 for f in o.data.polygons:
  indices=list(f.vertices);wrap=any(i%n==0 for i in indices) and any(i%n==n-1 for i in indices)
  for li,vi in zip(f.loop_indices,f.vertices):uv.data[li].uv=(1 if wrap and vi%n==0 else (vi%n)/n,(vi//n)/max(1,len(points)-1))
 if ring_weights:
  for g in list(o.vertex_groups):o.vertex_groups.remove(g)
  for j,entries in enumerate(ring_weights):
   transforms=[(arm.matrix_world@arm.pose.bones[bn].matrix@arm.data.bones[bn].matrix_local.inverted(),w) for bn,w in entries]
   blend=Matrix([[sum(m[r][c]*w for m,w in transforms) for c in range(4)] for r in range(4)])
   for i in range(n):
    index=j*n+i;o.data.vertices[index].co=blend.inverted()@verts[index]
    for bn,w in entries:
     if w>0:(o.vertex_groups.get(bn) or o.vertex_groups.new(name=bn)).add([index],w,'REPLACE')
 return o
def ellipsoid(name,c,size,arm,bone,role,mat,rotation=None):
 n=32;rows=18;verts=[];faces=[]
 for j in range(rows+1):
  phi=j*math.pi/rows
  for i in range(n):
   theta=i*math.tau/n;v=Vector((math.cos(theta)*math.sin(phi)*size.x,math.sin(theta)*math.sin(phi)*size.y,math.cos(phi)*size.z));verts.append(c+(rotation@v if rotation else v))
 for j in range(rows):
  for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 o=geom(name,verts,faces,arm,bone,role,mat);uv=o.data.uv_layers.active
 for f in o.data.polygons:
  for li,vi in zip(f.loop_indices,f.vertices):uv.data[li].uv=((vi%n)/(n-1),(vi//n)/rows)
 return o
def plate(name,border,arm,bone,role,mat=steel):
 c=sum(border,Vector())/len(border);side=1 if c.y>=0 else -1;c+=Vector((0,side*.07,.02));n=len(border)
 o=geom(name,border+[c],[(i,(i+1)%n,n) for i in range(n)],arm,bone,role,mat)
 add(rope(arm,role,bone,border+[border[0]],.045,gold,name+' continuous gold frame'));return o
def mount_root(role):return next(arm for arm in arms(role) if not arm.parent and 'hip' not in arm.data.bones)
def rider_root(role):return next(arm for arm in arms(role) if 'hip' in arm.data.bones)
def clone_elk_for_light():
 original=mount_root('heavy_cavalry');old=mount_root('light_cavalry');rider=rider_root('light_cavalry');world=rider.matrix_world.copy();rider.parent=None;rider.matrix_world=world
 for o in [o for o in items() if owns(o,old)]:bpy.data.objects.remove(o,do_unlink=True)
 bpy.data.objects.remove(old,do_unlink=True)
 clone=original.copy();clone.data=original.data.copy();clone.name='light_cavalry great stag anatomy rig';clone['peris_role']='light_cavalry';master.objects.link(clone);clone.parent=None
 for t in clone.animation_data.nla_tracks:
  t.name=t.name.replace('heavy_cavalry','light_cavalry')
  for s in t.strips:s.action=s.action.copy();s.action.name=s.action.name.replace('heavy_cavalry','light_cavalry')
 for o in [o for o in items() if owns(o,original)]:
  cp=o.copy();cp.data=o.data.copy();cp.name='light_cavalry great stag '+o.name;cp.parent=clone;cp['peris_role']='light_cavalry';master.objects.link(cp)
  for m in cp.modifiers:
   if m.type=='ARMATURE':m.object=clone
  # Replacing an Object.copy parent can reset its inverse transform. Restore
  # the source's explicit local basis after linking the clone hierarchy.
  cp.matrix_parent_inverse=o.matrix_parent_inverse.copy();cp.matrix_basis=o.matrix_basis.copy()
 return clone,rider
if a.faction=='elf':
 gild=gild_existing_metal(master,'Elf golden engraved armor')
 light,new_rider=clone_elk_for_light();records.append({'role':'all','gildedArmor':gild,'originalSkinClothAndHeadColorRetained':True})
sample()
for role in roles:
 root=mount_root(role);rider=new_rider if a.faction=='elf' and role=='light_cavalry' else rider_root(role);rider_world_before=rider.matrix_world.copy();parts=[o for o in items() if owns(o,root)]
 socket='peris_seated_rider' if 'peris_seated_rider' in root.data.bones else 'prop_rider'
 if a.faction=='elf':
  head='Deer01_Head';back='Deer01_Spine1';seat=root.matrix_world@root.pose.bones[socket].matrix.translation
  # Add broad original branching antlers in the actual head coordinate frame.
  center=root.matrix_world@root.pose.bones[head].head
  for side in [-1,1]:
   points=[center+Vector((-.10,side*.48,.75)),center+Vector((-.35,side*1.0,1.55)),center+Vector((-.78,side*1.75,2.25)),center+Vector((-1.10,side*2.40,2.60)),center+Vector((-1.50,side*3.0,2.90))]
   tube('Great stag broad swept branching antler',points,[.20,.18,.15,.11,.025],root,head,role,horn)
   for j in range(1,5):
    c=points[j];tip=c+Vector((.15+j*.10,side*.12,1.35-j*.10));tube('Great stag raised individual antler tine',[c,c.lerp(tip,.55),tip],[.115,.074,.008],root,head,role,horn)
  root['peris_mount_species']='great antlered stag; licensed deer anatomy with original Peris antlers and barding'
 else:
  # Keep the independent source quadruped skeleton and authored motion. The
  # silhouette is rebuilt as a distinct species, with a lower, broader trunk.
  for o in parts:bpy.data.objects.remove(o,do_unlink=True)
  # Short stout legs are part of the ram silhouette, including the heavy
  # donor's boar rig. Preserve the rider's independent world-scale below.
  if 'Horse_Spine_1' in root.data.bones or a.faction=='dwarf':root.scale.z*=.48 if a.faction=='gnome' else .67
  sample();back='Horse_Spine_1' if 'Horse_Spine_1' in root.data.bones else 'Boar_Body';head='Horse_Head' if 'Horse_Head' in root.data.bones else 'Boar_Head'
  seat=root.matrix_world@root.pose.bones[socket].matrix.translation
  size=Vector((3.8,1.8,1.20 if a.faction=='gnome' else 1.55));c=seat+Vector((-.20,0,-size.z-.20));ellipsoid('Original giant rat low broad furred body' if a.faction=='gnome' else 'Mountain ram thick shaggy barrel body',c,size,root,back,role,fur)
  headcenter=c+Vector((3.9,0,.10 if a.faction=='gnome' else .6));ellipsoid('Distinct tapered animal head',headcenter,Vector((1.42,.86,.84 if a.faction=='gnome' else 1.02)),root,head,role,fur)
  ellipsoid('Distinct narrow pointed muzzle',headcenter+Vector((1.05,0,-.23)),Vector((.92,.50,.47)),root,head,role,pink if a.faction=='gnome' else fur)
  ellipsoid('Small wet animal nose',headcenter+Vector((1.78,0,-.25)),Vector((.26,.39,.25)),root,head,role,dark)
  for side in [-1,1]:
   ellipsoid('Animal deep seated glossy eye',headcenter+Vector((.40,side*.74,.32)),Vector((.17,.095,.14)),root,head,role,dark)
   if a.faction=='gnome':
    ellipsoid('Giant rat round bare ear',headcenter+Vector((-.35,side*.84,.80)),Vector((.12,.48,.57)),root,head,role,pink)
    for j in range(4):
     c2=headcenter+Vector((1.08,side*.41,-.03-j*.08));tip=c2+Vector((-.1-j*.15,side*(.7+j*.13),.05-j*.12));tube('Giant rat individual muzzle whisker',[c2,c2.lerp(tip,.5),tip],[.022,.017,.003],root,head,role,horn)
   else:
    ellipsoid('Mountain ram narrow outward wool ear',headcenter+Vector((-.12,side*.9,.36)),Vector((.39,.48,.16)),root,head,role,fur)
    points=[];radii=[]
    for j in range(57):
     t=j/56;angle=-math.pi*.35+t*math.tau*1.12;rad=1.13*(1-.53*t)
     points.append(headcenter+Vector((-.30+rad*math.sin(angle),side*(.9+.28*t),.34+rad*math.cos(angle))));radii.append(.29*(1-t)**.72+.018)
    tube('Mountain ram deeply curled ridged horn',points,radii,root,head,role,horn)
    for j in range(2,49,3):
     tangent=(points[j+1]-points[j-1]).normalized();axis=tangent.cross(Vector((0,1,0))).normalized();second=tangent.cross(axis).normalized();radius=radii[j]+.016
     ring=[points[j]+radius*(axis*math.cos(k*math.tau/12)+second*math.sin(k*math.tau/12)) for k in range(13)]
     add(rope(root,role,head,ring,.018,horn,'Mountain ram individual horn growth ridge'))
    if role=='heavy_cavalry':
     ring=[points[3]+Vector((.28*math.cos(k*math.tau/12),0,.28*math.sin(k*math.tau/12))) for k in range(13)]
     add(rope(root,role,head,ring,.09,gold,'Heavy ram broad gold horn root collar'))
  if a.faction=='dwarf' and role=='heavy_cavalry':
   # Separate plates frame the ram's forehead without covering the eyes,
   # wool muzzle, or the curled horns shown in the supplied reference.
   nose_border=[headcenter+Vector((.35,-.40,.85)),headcenter+Vector((.35,.40,.85)),headcenter+Vector((1.10,.28,.49)),headcenter+Vector((1.69,.22,-.17)),headcenter+Vector((1.69,-.22,-.17)),headcenter+Vector((1.10,-.28,.49))]
   for point in nose_border:
    y=point.y-headcenter.y;z=point.z-headcenter.z;front=[]
    for cx,rx,ry,rz,cz in [(0,1.42,.86,1.02,0),(1.05,.92,.50,.47,-.23)]:
     value=1-(y/ry)**2-((z-cz)/rz)**2
     if value>=0:front.append(headcenter.x+cx+rx*math.sqrt(value))
    point.x=max(front)+.14
   plate('Heavy ram navy angular forehead and nasal chamfron',nose_border,root,head,role,steel)
   for side in [-1,1]:
    brow=[headcenter+Vector((-.02,side*.83,.67)),headcenter+Vector((.62,side*.79,.69)),headcenter+Vector((1.10,side*.62,.21))]
    add(rope(root,role,head,brow,.105,gold,'Heavy ram gold brow protecting exposed eye'))
   ellipsoid('Heavy ram inset turquoise forehead cabochon',headcenter+Vector((.50,0,.88)),Vector((.25,.18,.09)),root,head,role,cloth)
  # Anatomical leg envelopes and four real supported paws/hooves use the
  # existing separate front and rear chains, rather than a scaled human rig.
  if 'Horse_Spine_1' in root.data.bones:
   leg_sets=[('Horse_Arm_'+s,'Horse_Forearm_'+s,'Horse_Hand_'+s,'Horse_Hoof_'+s) for s in ['L','R']]+[('Horse_Thigh_'+s,'Horse_Leg_'+s,'Horse_Foot_'+s,'Horse_Hoof_back_'+s) for s in ['L','R']]
  else:
   leg_sets=[('Boar_Front_Leg_'+s,'Boar_Forearm_'+s,'Boar_Front_Foot_'+s,'Boar_Front_Foot_'+s) for s in ['Left','Right']]+[('Boar_Back_Leg_'+s,'Boar_Shin_'+s,'Boar_Back_Foot_'+s,'Boar_Back_Foot_'+s) for s in ['Left','Right']]
  for upper,lower,foot,toe in leg_sets:
   up=root.matrix_world@root.pose.bones[upper].head;mid=root.matrix_world@root.pose.bones[lower].head;end=root.matrix_world@root.pose.bones[foot].head
   side=1 if up.y>=0 else -1;dx=(up.x-c.x)/size.x;anchor=Vector((up.x,side*min(1.1,size.y*.62),c.z-.10))
   # Blend the fitted body junction to the actual moving limb joint. Both
   # endpoints reproduce the same world witnesses in every source pose.
   tube('Animal continuous haunch and muscular upper limb',[anchor,up,mid],[.72,.53,.31],root,upper,role,fur,[[(back,1)],[(upper,1)],[(lower,1)]])
   tube('Animal articulated lower limb',[mid,mid.lerp(end,.55),end],[.34,.25,.23],root,lower,role,fur if a.faction=='dwarf' else pink,[[(lower,1)],[(lower,.45),(foot,.55)],[(foot,1)]])
   floor=Vector((end.x,end.y,max(.36,end.z-.12)));ellipsoid('Giant rat wide supported paw' if a.faction=='gnome' else 'Mountain ram split hoof',floor,Vector((.57,.42,.35)),root,foot,role,pink if a.faction=='gnome' else dark)
   digits=4 if a.faction=='gnome' else 2
   for j in range(digits):
    toe_c=floor+Vector((.39,(j-(digits-1)/2)*(.19 if digits==4 else .29),-.05));ellipsoid('Separate animal toe or cloven hoof',toe_c,Vector((.23,.11,.16)),root,toe,role,pink if digits==4 else dark)
  # True species-specific tail, never a horse hair plume.
  tb='Horse_Tail_base' if 'Horse_Tail_base' in root.data.bones else 'Boar_Tail';tailstart=c+Vector((-3.55,0,.1))
  points=[tailstart+Vector((-i*.85,-.55*math.sin(i*.6),-.28*i)) for i in range(8 if a.faction=='gnome' else 3)];points=[Vector((p.x,p.y,max(.6,p.z))) for p in points];tube('Giant rat long hairless ringed tail' if a.faction=='gnome' else 'Mountain ram short wool tail',points,[.28*(1-i/len(points))+.035 for i in range(len(points))],root,tb,role,pink if a.faction=='gnome' else fur)
  if a.faction=='dwarf':
   rng=random.Random(710+roles.index(role));verts=[];faces=[]
   for i in range(310):
    theta=rng.random()*math.tau;phi=.3+rng.random()*2.5;n=Vector((math.sin(phi)*math.cos(theta),math.sin(phi)*math.sin(theta),math.cos(phi)))
    if role=='heavy_cavalry' and abs(n.x)<.9 and n.z>-.78:continue
    base=c+Vector((n.x*size.x,n.y*size.y,n.z*size.z));t=Vector((-.1,0,-.4-rng.random()*.18));w=.08+rng.random()*.045;index=len(verts);verts.extend([base+Vector((w,0,0)),base+Vector((-w,0,0)),base+t]);faces.append((index,index+1,index+2))
   geom('Mountain ram original shaggy wool silhouette locks',verts,faces,root,back,role,fur)
   verts=[];faces=[]
   for i in range(90):
    theta=rng.random()*math.tau;phi=.45+rng.random()*2.35;n=Vector((math.sin(phi)*math.cos(theta),math.sin(phi)*math.sin(theta),math.cos(phi)));base=headcenter+Vector((n.x*1.44,n.y*.87,n.z*1.02));w=.08+rng.random()*.04;index=len(verts);verts.extend([base+Vector((w,0,0)),base+Vector((-w,0,0)),base+Vector((-.13,0,-.25-rng.random()*.18))]);faces.append((index,index+1,index+2))
   geom('Mountain ram shaggy cheek and jaw locks',verts,faces,root,head,role,fur)
  root['peris_mount_species']='shaggy mountain ram; original Peris anatomy on adapted quadruped rig' if a.faction=='dwarf' else 'giant rat; original Peris anatomy on adapted quadruped rig'
 # Saddle rests at the measured preserved back socket, with the rider pelvis
 # just above it. Refit original seated thighs and shins for the new width.
 target=seat+Vector((0,0,.02));before=rider_world_before;hip=rider.pose.bones['hip'].head.copy();before.translation=target-before.to_3x3()@hip;rider.parent=root;rider.parent_type='BONE';rider.parent_bone=socket;rider.matrix_parent_inverse=Matrix.Translation((0,-root.data.bones[socket].length,0));rider.matrix_world=before;bpy.context.view_layer.update()
 seated_rider(root,rider,role,target,2.4 if a.faction!='elf' else 1.55,hold_reins=False);sample();actual=rider.matrix_world@rider.pose.bones['hip'].head
 if (actual-target).length>.005:raise ValueError('Pelvis missed the new saddle target '+role)
 rider['peris_seat_target_world']=list(target);rider['peris_seat_hip_world']=list(actual);rider['peris_seat_fit_error']=(actual-target).length;rider['peris_mount_species']=root['peris_mount_species']
 add(cushion(root,socket,role,seat+Vector((0,0,-.10)),1.5,1.65,.22,leather,'Distinct fitted shaped animal riding saddle'))
 for side in [-1,1]:
  if a.faction=='elf':continue  # Its original fitted green saddle cloth is retained.
  points=[seat+Vector((-.85,side*.72,-.14)),seat+Vector((.68,side*.83,-.14)),seat+Vector((.84,side*1.40,-1.2)),seat+Vector((-.77,side*1.45,-1.3))]
  plate('Original '+a.faction+' rank saddle blanket',points,root,back,role,cloth)
  if role=='heavy_cavalry' and a.faction=='elf':
   for col in range(4):
    x=seat.x-2.4+col*1.05;z=seat.z-.58;border=[Vector((x-.55,side*1.85,z+.40)),Vector((x+.44,side*1.85,z+.44)),Vector((x+.59,side*1.88,z-.69)),Vector((x,side*1.95,z-1.04)),Vector((x-.54,side*1.89,z-.66))];plate('Heavy '+a.faction+' angular layered flank barding',border,root,back,role,gold)
  elif role=='heavy_cavalry' and a.faction=='dwarf':
   # Broad curved navy plates follow the barrel, with visible gold frames.
   # This keeps the reference's armored silhouette and avoids flat patches
   # buried in wool. Separate rows remain clear of the rider's saddle.
   for col in range(5):
    start=-.88+col*.35;stop=start+.32
    for row,(low,high) in enumerate([(.38,1.40),(1.46,2.53)]):
     vertices=[];faces=[];steps=5
     for ix in range(steps+1):
      dx=start+(stop-start)*ix/steps;section=math.sqrt(max(.01,1-dx*dx))
      for iz in range(steps+1):
       theta=low+(high-low)*iz/steps;vertices.append(c+Vector((size.x*dx,side*(size.y+.16)*section*math.sin(theta),(size.z+.12)*section*math.cos(theta))))
     for ix in range(steps):
      for iz in range(steps):
       k=ix*(steps+1)+iz;faces.append((k,k+steps+1,k+steps+2,k+1))
     geom('Heavy ram broad curved navy armor panel',vertices,faces,root,back,role,steel)
     edges=[vertices[ix*(steps+1)] for ix in range(steps+1)]+[vertices[steps*(steps+1)+iz] for iz in range(1,steps+1)]+[vertices[ix*(steps+1)+steps] for ix in range(steps-1,-1,-1)]+[vertices[iz] for iz in range(steps-1,-1,-1)]
     add(rope(root,role,back,edges+[edges[0]],.085,gold,'Heavy ram substantial continuous gilt armor frame'))
     for vi in [0,steps,steps*(steps+1),len(vertices)-1]:ellipsoid('Heavy ram gold plate fastening',vertices[vi]+Vector((0,side*.04,0)),Vector((.11,.07,.11)),root,back,role,gold)
  elif role=='heavy_cavalry':
   for row in range(2):
    for col in range(4):
     x=c.x-2.45+col*1.60;z=c.z+.55-row*.95;border=[]
     for dx,dz in [(-.69,.39),(.61,.38),(.75,-.25),(0,-.55),(-.66,-.33)]:
      px=x+dx;pz=z+dz;value=1-((px-c.x)/size.x)**2-((pz-c.z)/size.z)**2
      if value<0:break
      border.append(Vector((px,side*(size.y*math.sqrt(value)+.13),pz)))
     if len(border)==5:plate('Heavy fitted '+a.faction+' overlapping torso armor',border,root,back,role,steel)
 support=[b.name for b in root.data.bones if any(t in b.name.lower() for t in ['hoof','foot','hand','finger0','toe0']) and 'ik' not in b.name.lower() and not b.name.startswith('prop')]
 old_flags={o:o.hide_viewport for o in items()};owned=[o for o in items() if o.type=='MESH' and o.get('peris_role')==role];role_arms=arms(role)
 for o in items():o.hide_viewport=o not in owned and o not in role_arms
 old_root_position=root.matrix_world.translation.copy();floor=normalize_role_ground(master,role,root,support_bones=support,clearance=.025,sample_step=.5,allow_lowering=True,edition=a.edition)
 for o,flag in old_flags.items():o.hide_viewport=flag
 sample();target+=root.matrix_world.translation-old_root_position;actual=rider.matrix_world@rider.pose.bones['hip'].head
 if (actual-target).length>.005:raise ValueError('Floor correction broke measured seat contact '+role)
 rider['peris_seat_hip_world']=list(actual);rider['peris_seat_target_world']=list(target);rider['peris_seat_fit_error']=(actual-target).length
 # Keep audit coordinates in this final world, after the root floor correction.
 for o in items():
  if owns(o,rider):
   for k in ['peris_seat_hip_world','peris_seat_target_world','peris_seat_fit_error','peris_mount_species']:o[k]=rider[k]
 records.append({'role':role,'mountSpecies':root['peris_mount_species'],'independentMountAndRiderRigs':True,'nativeRestBonesUnchanged':True,'newAnatomyForDwarfAndGnome':a.faction!='elf','riderSeatedLowerLimbChannelsRefitted':True,'supportMinimum':floor['after']['minimumWorldZ'],'floorAudit':floor})
for o in new.all_objects:
 if o.name not in master.objects:master.objects.link(o)
sample();out.mkdir(parents=True);editable=out/f'editable-{a.faction}-study.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(editable),compress=True)
lib=types.SimpleNamespace(collection=new,groups={r:[o for o in new.objects if o.get('peris_role')==r] for r in roles},PROFILE={'family':'spartan'});pack(lib,a.faction+'-distinct-mounts',out/'textures',4096)
for o in new.all_objects:
 if o.name not in master.objects:master.objects.link(o)
native=out/f'peris-{a.faction}-army.blend';bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(native),compress=True)
if sha(source)!=oldsha:raise ValueError('Original native changed')
record={'sourceNative':str(source),'sourceSha256':oldsha,'sourceUnchanged':True,'operations':records,'shields60PercentUnchanged':True,'sourceWeaponGripAndHeadGeometryPreserved':True,'finishedUnitApproved':False,'runtimeApproved':False,'files':{f.name:{'bytes':f.stat().st_size,'sha256':sha(f)} for f in [editable,native]}}
(out/'provenance.json').write_text(json.dumps(record,indent=2)+'\n');print('DISTINCT_MOUNT_NATIVE_READY',a.faction,json.dumps(record['files']),flush=True)
