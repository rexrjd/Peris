"""Isolated, topology-preserving CC4 Orc head adaptation for portrait review.

No recoloring or directional paint. The existing dense tangent bake is retained
for this mild shape trial; an integrated stronger sculpt needs its own bake QA.
"""
import json
import bpy
import numpy as np
from mathutils import Matrix,Vector


def _islands(mesh):
    links={v.index:set() for v in mesh.vertices}
    for edge in mesh.edges:
        a,b=edge.vertices;links[a].add(b);links[b].add(a)
    remaining=set(links);result=[]
    while remaining:
        group={min(remaining)};todo=list(group)
        while todo:
            for v in links[todo.pop()]-group:group.add(v);todo.append(v)
        remaining-=group;result.append(sorted(group))
    return result


def _field(x,z,cx,cz,wx,wz,power=4):
    return np.exp(-((x-cx)/wx)**power-((z-cz)/wz)**power)


def _validate(mesh,old,new):
    mesh.calc_loop_triangles();tris=np.asarray([list(t.vertices) for t in mesh.loop_triangles])
    a=np.cross(old[tris[:,1]]-old[tris[:,0]],old[tris[:,2]]-old[tris[:,0]])
    b=np.cross(new[tris[:,1]]-new[tris[:,0]],new[tris[:,2]]-new[tris[:,0]])
    area_a=np.linalg.norm(a,axis=1);area_b=np.linalg.norm(b,axis=1);valid=area_a>1e-12
    cos=np.sum(a*b,axis=1)/np.maximum(area_a*area_b,1e-18)
    flipped=int(np.sum(valid&(cos<=0)));collapsed=int(np.sum(valid&(area_b<area_a*.20)))
    if flipped or collapsed:raise ValueError('Reject new flipped/collapsed facial triangles: '+str((flipped,collapsed)))
    return {'triangleCount':len(tris),'newFlippedTriangles':flipped,'newCollapsedTrianglesBelow20PercentArea':collapsed,'minimumChangedTriangleNormalCosine':float(cos[valid].min()),'minimumAreaRatio':float((area_b[valid]/area_a[valid]).min())}


def _geometry_normals(mesh,points):
    tris=np.asarray([list(t.vertices) for t in mesh.loop_triangles])
    face=np.cross(points[tris[:,1]]-points[tris[:,0]],points[tris[:,2]]-points[tris[:,0]])
    normal=np.zeros_like(points)
    for column in range(3):np.add.at(normal,tris[:,column],face)
    return normal/np.maximum(np.linalg.norm(normal,axis=1)[:,None],1e-12)


def _transport_corner_normals(mesh,old,new,source):
    """Retain authored smoothing offsets through a local minimal rotation."""
    a=_geometry_normals(mesh,old);b=_geometry_normals(mesh,new)
    cross=np.cross(a,b);sine=np.linalg.norm(cross,axis=1);cosine=np.clip(np.sum(a*b,axis=1),-1,1)
    axis=cross/np.maximum(sine[:,None],1e-12)
    ids=np.asarray([loop.vertex_index for loop in mesh.loops]);k=axis[ids];c=cosine[ids,None];s=sine[ids,None]
    transported=source*c+np.cross(k,source)*s+k*np.sum(k*source,axis=1)[:,None]*(1-c)
    unchanged=sine[ids]<1e-9;transported[unchanged]=source[unchanged]
    transported/=np.maximum(np.linalg.norm(transported,axis=1)[:,None],1e-12)
    mesh.normals_split_custom_set(transported.tolist())
    return {'method':'Minimal local rotation from area-weighted old/new geometric vertex normals; authored per-corner smoothing offset retained','sourceCornerCount':len(source),'maximumGeometryNormalRotationDegrees':float(np.degrees(np.arccos(cosine)).max()),'denseTangentNormalPixelsChanged':False}


def apply_portrait_face_refinement(arm,role='line_infantry'):
    """Apply only to a new unpacked duplicate, after color paint and before atlas."""
    if role not in {'line_infantry','spear_guard','elite','archer'}:raise ValueError('Unsupported Orc portrait infantry role')
    if role!='line_infantry' and not arm.get('peris_licensed_head_credit'):
        raise ValueError('Additional Orc roles require explicit licensed-head component provenance')
    if arm.get('peris_portrait_face_refinement'):raise ValueError('Face refinement already applied')
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('peris_role')==role
             and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]
    parts={kind:next((o for o in objects if 'source-head-'+kind in o.name),None) for kind in ['skin','eyes','teeth','tusks']}
    if any(o is None for o in parts.values()):raise ValueError('Expected all four credited source head components')
    if any(uv.name=='PerisAtlas' for o in parts.values() for uv in o.data.uv_layers):raise ValueError('Apply to unpacked source UV geometry only')
    if any(o.get('asset_license')!='CC-BY-4.0' for o in parts.values()):raise ValueError('Expected credited CC4 adaptation; preserve source provenance')
    fit=Matrix.Translation(Vector(arm['peris_orc_head_center']))@Matrix.Diagonal((5.5,5,5.7,1))@Matrix.Translation(-Vector((0,-.012,.215)))
    inv=fit.inverted();before={kind:np.asarray([list(v.co) for v in o.data.vertices]) for kind,o in parts.items()};records=[]
    source_normals={kind:np.asarray([list(n.vector) for n in o.data.corner_normals]) for kind,o in parts.items() if getattr(o.data,'has_custom_normals',False)}
    try:
        for kind,obj in parts.items():
            points=np.asarray([list(inv@v.co) for v in obj.data.vertices]);new=points.copy()
            x,y,z=points.T;ax=np.abs(x);front=np.clip((-y-.025)/.016,0,1)
            if kind=='skin':
                # Connected orbital mass moves with the actual eyelid surface.
                # Inner brow descends slightly more than the outer brow.
                brow=_field(ax,z,.015,.2465,.018,.010)*front
                upper=_field(ax,z,.0165,.2408,.013,.0044)*front
                lower=_field(ax,z,.0165,.2350,.012,.0037)*front
                new[:,1]-=.0015*brow+.00035*upper+.00035*lower
                new[:,2]-=.00080*brow*np.exp(-((ax-.010)/.010)**2)+.00115*upper
                new[:,2]+=.00055*lower
                cheek=_field(ax,z,.031,.226,.012,.013)*front
                cheek_plane=-.043+.32*(ax-.028)+.12*(z-.226)
                new[:,1]+=np.clip((cheek_plane-y)*.30,-.0016,.0016)*cheek
                new[:,0]+=np.sign(x)*.00085*cheek
                jaw=_field(ax,z,.031,.203,.011,.015)*front
                jaw_plane=-.043+.24*(ax-.026)-.12*(z-.205)
                new[:,1]+=np.clip((jaw_plane-y)*.23,-.0015,.0015)*jaw
                new[:,0]+=np.sign(x)*.00115*jaw
                # Keep chin connected but reduce its forward, rounded bulge.
                chin=_field(x,z,0,.194,.018,.012)*front
                new[:,1]+=.00085*chin
                # Close the lower mouth coherently with its gum/tooth/tusk
                # components, fading into the connected cheek and neck.
                lower_jaw=np.clip((z-.184)/.008,0,1)*np.clip((.209-z)/.004,0,1)*front*np.exp(-(ax/.041)**8)
                new[:,2]+=.00135*lower_jaw
            elif kind=='eyes':
                # Seating is a complete component translation, preserving the
                # original eye topology and iris UV relationship.
                new[:,1]+=.00055
            elif kind=='teeth':
                for island in _islands(obj.data):
                    p=points[island];upper=float(p[:,2].max())>.212
                    root=float(p[:,2].max() if upper else p[:,2].min())
                    new[island,2]=root+(p[:,2]-root)*.94+(.00135 if not upper else 0)
                    # Retreat only tips, keeping their gum/root position.
                    span=max(1e-8,float(p[:,2].max()-p[:,2].min()))
                    tip=np.abs(p[:,2]-root)/span;new[island,1]+=.00015*tip
            else:
                for island in _islands(obj.data):
                    p=points[island];root=.2005;top=max(root+1e-8,float(p[:,2].max()))
                    t=np.clip((p[:,2]-root)/(top-root),0,1)
                    new[island,2]+=.00135-.08*(p[:,2]-root)*t
                    center=p[t<.25].mean(0) if np.any(t<.25) else p.mean(0)
                    new[island,0]=center[0]+(p[:,0]-center[0])*(1-.08*t)+np.sign(center[0])*.00030*t
                    new[island,1]=center[1]+(p[:,1]-center[1])*(1-.08*t)+.00020*t
            fitted=np.asarray([list(fit@Vector(p)) for p in new]);validation=_validate(obj.data,before[kind],fitted)
            obj.data.vertices.foreach_set('co',fitted.astype(np.float32).ravel());obj.data.update()
            transport=_transport_corner_normals(obj.data,before[kind],fitted,source_normals[kind]) if kind in source_normals else None
            obj.data.update()
            records.append({'component':kind,'mesh':obj.name,'vertexCount':len(points),'movedVertexCount':int(np.sum(np.linalg.norm(new-points,axis=1)>1e-8)),'maxSourceCoordinateDisplacement':float(np.linalg.norm(new-points,axis=1).max()),'maxFittedArmCoordinateDisplacement':float(np.linalg.norm(fitted-before[kind],axis=1).max()),'validation':validation,'authoredCornerNormalTransport':transport})
    except Exception:
        for kind,obj in parts.items():
            obj.data.vertices.foreach_set('co',before[kind].astype(np.float32).ravel());obj.data.update()
            if kind in source_normals:obj.data.normals_split_custom_set(source_normals[kind].tolist())
        raise
    record={'author':'Peris: mild portrait-directed adaptation of the credited Crazyon520 CC-BY-4.0 head geometry','reference':'public/art/battle/roster/orc.png upper-left Axe Warrior','variant':2,'components':records,'operations':['Connected inner brow/orbital mass and narrower upper/lower eyelid opening','Existing eye components seated .00055 source units rearward, no new eye mesh or UV paint','Mild connected cheek/jaw plane refinement and reduced rounded chin projection','Connected lower jaw/lip closes .00135 source units with complete lower tooth and tusk components following; neck/upper face fade preserved','Teeth shortened mildly to94 percent around each complete island root, tip slightly recessed','Existing tusk roots follow jaw; mild upper taper, eight-percent height refinement and outward tips'],'topologyChanged':False,'uvChanged':False,'rigChanged':False,'weightsChanged':False,'animationChanged':False,'materialPaintChanged':False,'sourceNormalImagePixelsChanged':False,'limitations':['Existing dense tangent bake remains for this mild adaptation; source-shape correspondence and directional shading need actual visual review.','No new dense sculpt/reprojection or orbital topology is generated.','Reject the trial if eyelids pinch, iris alignment or source normal shading worsens.'],'runtimeApproved':False,'finishedUnitApproved':False}
    record['role']=role
    if role!='line_infantry':
        record['sharedOrcReference']=record['reference']
        record['roleSpecificPortraitApproved']=False
    arm['peris_portrait_face_refinement']=json.dumps(record)
    return record
