"""Owned mounted appearance pass. Preserve V7 pose, rig and rein controls."""
import bpy,math,json,pathlib,importlib.util
from mathutils import Vector
import orc_mounted_prototypes as model
import orc_mounted_fit as fit
import roster_species


def finish_rest_mesh(obj,arm,role,bone,mat):
    for c in list(obj.users_collection):c.objects.unlink(obj)
    bpy.data.collections['PERIS_EXPORT'].objects.link(obj)
    obj.parent=arm;obj.data.materials.clear();obj.data.materials.append(mat)
    obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))),1,'REPLACE')
    mod=obj.modifiers.new('Preserved mounted anatomical attachment','ARMATURE');mod.object=arm
    obj.name=role+' '+obj.name;obj['peris_role']=role
    obj['asset_author']='Peris, with Wildfire Games wrist adaptation';obj['asset_license']='CC-BY-SA-3.0'
    obj['original_peris_equipment']=True;obj['runtime_approved']=False;obj['peris_unit_finished']=False
    return obj


def shaped_hands(rider,role,root):
    # Existing cavalry hand cuts are preserved. Use the frozen original
    # anatomical digit construction and query each actual retained wrist lip.
    source=root/'scripts/blender/orc_mounted_hand_geometry_v11.py'
    spec=importlib.util.spec_from_file_location('mounted_v11_digit_source',str(source))
    hands=importlib.util.module_from_spec(spec);spec.loader.exec_module(hands)
    parts=model.attached(rider)
    lib=type('MountedParts',(),{'groups':{role:parts}})()
    skin=next(m for m in bpy.data.materials if m.name.startswith('Original Orc hand olive skin Peris portrait surface study'))
    contexts={side:hands._source_wrist(lib,rider,role,side) for side in ['R','L']}
    added=[]
    for side in ['R','L']:
        radius=.068 if side=='R' else .058
        obj,report=hands._make_local(side,contexts[side],radius)
        bone=rider.data.bones['hand_'+side]
        obj.data.transform(bone.matrix_local);obj.data.update()
        finish_rest_mesh(obj,rider,role,bone.name,skin)
        report['wristBinding']=hands._wrist_weights(obj,rider,side,contexts[side],radius)
        obj['peris_mounted_anatomical_hand']=side;obj['peris_grip_reserved_haft_radius']=radius
        obj['peris_hand_construction_report']=json.dumps(report)
        obj['peris_closed_grip']='Broad palm, four distinct tapered curled digits and opposed fused thumb; actual source wrist fit'
        added.append({'object':obj.name,'side':side,'radius':radius,'construction':report})
    removed=[]
    for obj in parts:
        if any(s in obj.name for s in ['Original connected closed Orc grip hand','Original Orc closed thumb over grip','Original connected Orc wrist to palm bridge']):
            removed.append(obj.name);bpy.data.objects.remove(obj,do_unlink=True)
    return {'source_digit_module':str(source),'added':added,'removed_legacy_grips':removed,
            'source_body_cuts_unchanged':True,'no_new_bones_or_clips':True}


def short_collar(rider,role,mat):
    obj=next(o for o in model.attached(rider) if 'gorget collar' in o.name)
    neck=rider.data.bones['neck'].head_local
    lo=min(v.co.z for v in obj.data.vertices);hi=max(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        t=(v.co.z-lo)/(hi-lo);x,y=v.co.x-neck.x,v.co.y-neck.y
        angle=math.atan2(x,y)
        v.co.x=neck.x+x*(1-.14*t);v.co.y=neck.y+y*(1-.14*t)
        v.co.z=lo+(v.co.z-lo)*.53+.009*math.sin(angle*3)*t
    obj.data.materials.clear();obj.data.materials.append(mat);obj.data.update()
    obj['peris_mounted_collar_refinement']='Height 53 percent, tapered upper edge and restrained folded profile; original neck weighting'
    return {'object':obj.name,'old_z_bounds':[lo,hi],'new_z_bounds':[min(v.co.z for v in obj.data.vertices),max(v.co.z for v in obj.data.vertices)]}


def leather_reins(rider,role,mat):
    changed=[]
    for obj in model.attached(rider):
        if ' rein ' not in obj.name:continue
        for row in range(len(obj.data.vertices)//8):
            ring=list(obj.data.vertices)[row*8:(row+1)*8]
            center=sum((v.co for v in ring),Vector())/8
            # Preserve every cross-section center and all existing weights.
            if role!='scout':
                bone=rider.data.bones[obj.vertex_groups[ring[0].groups[0].group].name]
                inverse=bone.matrix_local.inverted();local_center=inverse@center
                for v in ring:
                    local=inverse@v.co;delta=local-local_center
                    delta.x*=.46;delta.z*=.14;v.co=bone.matrix_local@(local_center+delta)
            else:
                for v in ring:v.co=center+(v.co-center)*.36
        obj.data.materials.clear();obj.data.materials.append(mat);obj.data.update()
        obj['peris_mounted_leather_rein']='Thin dark leather section; all V7 centers/control weights/actions preserved'
        changed.append(obj.name)
    return changed


def bounds(obj):
    deps=bpy.context.evaluated_depsgraph_get();ev=obj.evaluated_get(deps);mesh=ev.to_mesh()
    try:points=[ev.matrix_world@v.co for v in mesh.vertices]
    finally:ev.to_mesh_clear()
    return Vector([min(p[i] for p in points) for i in range(3)]),Vector([max(p[i] for p in points) for i in range(3)])


def stud(arm,role,bone,point,size,mat,name='Mounted tack flush copper stud'):
    return model.cushion(arm,bone,role,Vector(point),size,size,size*.50,mat,name)


def body_girth(mount,role,body,x,bone,leather,metal):
    data=fit._evaluated_meshes([body],bpy.context.evaluated_depsgraph_get());vertices,tri,bvh=fit._combined(data)
    low=min(p.z for p in vertices);high=max(p.z for p in vertices);center=Vector((x,0,(low+high)*.60))
    pts=[];normals=[]
    for i in range(33):
        theta=math.tau*i/32;direction=Vector((0,math.sin(theta),math.cos(theta)))
        hit,normal,face,dist=bvh.ray_cast(center+direction*40,-direction,80)
        if hit is None:raise ValueError('No body girth ray '+role+' '+str(i))
        pts.append(hit+normal*.11);normals.append(normal)
    verts=[]
    for p,n in zip(pts,normals):
        for along,thick in [(-.14,-.035),(.14,-.035),(.14,.035),(-.14,.035)]:verts.append(p+Vector((along,0,0))+n*thick)
    faces=[(3,2,1,0),(128,129,130,131)]
    faces += [(r*4+c,r*4+(c+1)%4,(r+1)*4+(c+1)%4,(r+1)*4+c) for r in range(32) for c in range(4)]
    obj=model.prop_mesh('Body fitted wide hide girth',verts,faces,mount,bone,role,leather)
    for index in [8,24]:
        p=pts[index]+normals[index]*.055
        stud(mount,role,bone,p,.18,metal,'Girth side buckle boss')
        for d in [-.35,.35]:stud(mount,role,bone,p+Vector((0,0,d)),.085,metal)
    return {'object':obj.name,'source_body':body.name,'source_body_bone':bone,'actual_idle_surface_rays':len(pts),'offset':.11}


def mammoth_seat(mount,role,leather,dark_iron,copper,ochre):
    parts=model.attached(mount);changed=[]
    for obj in parts:
        if any(s in obj.name for s in ['Bronze riding deck edge','Visible mounted seat armrest','Lancer seat support','Lancer backrest']):
            obj.data.materials.clear();obj.data.materials.append(dark_iron);changed.append(obj.name)
    seat=next(o for o in parts if o.name==role+' Mounted lancer seat')
    lo,hi=bounds(seat);bone=seat.vertex_groups[0].name
    # Retain original supported seat; add rounded fitted hide cushion and a
    # studded front welt, without altering hip/seat height or chair supports.
    center=(lo+hi)*.5;center.z=hi.z-.02
    model.cushion(mount,bone,role,center,(hi.x-lo.x)*.97,(hi.y-lo.y)*.98,.26,leather,'Contoured mounted hide seat pad')
    for side in [-1,1]:
        pts=[Vector((lo.x+.12,side*(hi.y-.08),hi.z+.03)),Vector((center.x,side*(hi.y-.08),hi.z+.03)),Vector((hi.x-.12,side*(hi.y-.08),hi.z+.03))]
        model.rope(mount,role,bone,pts,.055,dark_iron,'Seat shaped iron welt')
        for i in range(5):stud(mount,role,bone,pts[0].lerp(pts[-1],i/4),.09,copper)
    deck=next(o for o in parts if o.name==role+' Narrow mammoth riding deck');dlo,dhi=bounds(deck)
    deck.data.materials.clear();deck.data.materials.append(leather)
    for side in [-1,1]:
        p=[Vector((dlo.x+.18,side*(dhi.y-.12),dhi.z+.08)),Vector((dhi.x-.18,side*(dhi.y-.12),dhi.z+.08))]
        model.rope(mount,role,deck.vertex_groups[0].name,p,.075,dark_iron,'Deck fitted dark iron rim')
        for i in range(8):stud(mount,role,deck.vertex_groups[0].name,p[0].lerp(p[-1],i/7),.10,copper)
    for old in [o for o in parts if 'Mammoth ochre saddle banner' in o.name]:
        lo,hi=bounds(old);bn=old.vertex_groups[0].name;sign=1 if (lo.y+hi.y)>0 else -1
        y=(lo.y+hi.y)/2;z=hi.z+.03
        outline=[Vector((lo.x+.16,y,z)),Vector((hi.x-.16,y,z)),Vector((hi.x,y,z-.28)),
                 Vector((hi.x-.28,y,lo.z+.20)),Vector(((lo.x+hi.x)/2,y,lo.z-.05)),Vector((lo.x+.28,y,lo.z+.20)),Vector((lo.x,y,z-.28))]
        n=len(outline);verts=[p+Vector((0,-.04,0)) for p in outline]+[p+Vector((0,.04,0)) for p in outline]
        faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        obj=model.prop_mesh('Shaped heavy saddle hide panel',verts,faces,mount,bn,role,ochre)
        uv=obj.data.uv_layers.active
        for li in range(len(obj.data.loops)):
            p=verts[obj.data.loops[li].vertex_index];uv.data[li].uv=((p.x-lo.x)/(hi.x-lo.x),(p.z-lo.z)/(hi.z-lo.z))
        rim=[p+Vector((0,sign*.07,0)) for p in outline]+[outline[0]+Vector((0,sign*.07,0))]
        model.rope(mount,role,bn,rim,.055,dark_iron,'Heavy hide panel fitted rim')
        for i,p in enumerate(rim[:-1]):stud(mount,role,bn,p,.14,copper,'Heavy hide panel corner stud')
        bpy.data.objects.remove(old,do_unlink=True)
    return {'recolored_supports':changed,'new_shaped_hide_panels':2,'existing_seat_supports_and_height_retained':True}
