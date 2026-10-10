"""Bounded giant head/stone finish; preserve the authored planted throw rig."""
import bpy,bmesh,hashlib,json,math,pathlib
import numpy as np
from mathutils import Vector,Matrix


def _image(name,pixels,noncolor=False):
 h,w,_=pixels.shape;image=bpy.data.images.new(name,width=w,height=h,alpha=False)
 if noncolor:image.colorspace_settings.name='Non-Color'
 image.pixels.foreach_set(np.asarray(pixels,dtype=np.float32).ravel());image.pack()
 return image


def _stone_material():
 size=1024;rng=np.random.default_rng(93208);field=np.zeros((size,size),dtype=np.float64)
 for count,weight in [(4,.25),(9,.20),(19,.14),(43,.10),(91,.07),(211,.05),(512,.025)]:
  grid=rng.uniform(-1,1,(count,count));coords=np.linspace(0,count-1,size);i=np.minimum(coords.astype(int),count-2)
  f=coords-i;f=f*f*(3-2*f);a=grid[i[:,None],i[None,:]];b=grid[i[:,None],i[None,:]+1]
  c=grid[i[:,None]+1,i[None,:]];d=grid[i[:,None]+1,i[None,:]+1]
  field+=weight*((a*(1-f[None,:])+b*f[None,:])*(1-f[:,None])+(c*(1-f[None,:])+d*f[None,:])*f[:,None])
 color=np.ones((size,size,4),dtype=np.float32);color[:,:,:3]=np.asarray((.235,.244,.231))*(1+field[:,:,None]*.68)
 flecks=rng.random((size,size));color[flecks>.992,:3]*=.64;color[flecks<.005,:3]*=1.28
 rough=np.ones_like(color);rough[:,:,:3]=np.clip(.91+field[:,:,None]*.09,.73,.99)
 dy,dx=np.gradient(field);normal=np.stack((-dx*8,-dy*8,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None]
 normals=np.ones_like(color);normals[:,:,:3]=normal*.5+.5
 mat=bpy.data.materials.new('Original Peris natural weathered giant granite');mat.use_nodes=True;nodes=mat.node_tree.nodes;p=nodes.get('Principled BSDF')
 for title,pixels,target,noncolor in [('Irregular granite minerals',color,'Base Color',False),('Granite rough fracture finish',rough,'Roughness',True)]:
  node=nodes.new('ShaderNodeTexImage');node.image=_image(title,pixels,noncolor);mat.node_tree.links.new(node.outputs['Color'],p.inputs[target])
 node=nodes.new('ShaderNodeTexImage');node.image=_image('Fine granite natural stone normal',normals,True)
 n=nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.45;mat.node_tree.links.new(node.outputs['Color'],n.inputs['Color']);mat.node_tree.links.new(n.outputs['Normal'],p.inputs['Normal'])
 p.inputs['Metallic'].default_value=0
 return mat


def apply_giant_refinement(arm,collection,accepted_head_native,role='catapult'):
 if role!='catapult' or arm.get('peris_giant_refinement'):raise ValueError('Use a fresh giant refinement derivative')
 path=pathlib.Path(accepted_head_native);source_hash=hashlib.sha256(path.read_bytes()).hexdigest()
 parts=[o for o in collection.all_objects if o.type=='MESH' and o.get('peris_role')==role and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers)]
 body=next(o for o in parts if o.get('peris_orc_original_anatomy'));stone=next(o for o in parts if 'Held siege boulder' in o.name)
 old_face=[]
 for obj in parts:
  groups={g.index:g.name for g in obj.vertex_groups}
  total=sum(g.weight for v in obj.data.vertices for g in v.groups)
  head=sum(g.weight for v in obj.data.vertices for g in v.groups if groups[g.group]=='prop-head')
  if total and head/total>.999:old_face.append(obj.name);bpy.data.objects.remove(obj,do_unlink=True)
 # Remove the superseded native head region only; the neck/arms remain.
 bm=bmesh.new();bm.from_mesh(body.data);layer=bm.verts.layers.deform.active;names={g.index:g.name for g in body.vertex_groups};neck=arm.data.bones['neck'].head_local.z
 remove=[f for f in bm.faces if sum(v.co.z for v in f.verts)/len(f.verts)>neck+.07 and sum(sum(w for i,w in v[layer].items() if names.get(i)=='head') for v in f.verts)/len(f.verts)>.18]
 removed_faces=len(remove);bmesh.ops.delete(bm,geom=remove,context='FACES_ONLY');bm.to_mesh(body.data);bm.free();body.data.update()
 with bpy.data.libraries.load(str(path),link=False) as (source,target):
  names=[n for n in source.objects if n.startswith('line_infantry ') and ('source-head-' in n or 'Fitted derivative volumetric Orc nape bridge' in n)]
  target.objects=names
 copied=list(target.objects)
 if len(copied)!=5:raise ValueError('Expected accepted four head components plus fitted nape bridge: '+str(names))
 source_arm=copied[0].parent;source_center=Vector(source_arm['peris_orc_head_center']);center=Vector(arm['peris_orc_head_center'])
 transform=Matrix.Translation(center)@Matrix.Diagonal((1.06,1.06,1.06,1))@Matrix.Translation(-source_center)
 credit=json.loads(source_arm['peris_licensed_head_credit']);credit['changes']+='; Peris giant fit: uniform 1.06 rest-space size around head center and giant neck translation; accepted stern gaze and dense source normal map retained'
 credit['acceptedHeadNativeSha256']=source_hash;credit['runtimeApproved']=False;credit['finishedUnitApproved']=False
 for obj in copied:
  obj.data=obj.data.copy();obj.data.transform(transform@obj.matrix_local);obj.parent=arm;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_basis=Matrix.Identity(4)
  for mod in obj.modifiers:
   if mod.type=='ARMATURE':mod.object=arm
  for c in list(obj.users_collection):c.objects.unlink(obj)
  collection.objects.link(obj);obj.name=role+' giant '+obj.name.removeprefix('line_infantry ');obj['peris_role']=role;obj['peris_component_credit']=json.dumps(credit)
  obj['peris_atlas_partition']='licensed-head';obj['runtime_approved']=False;obj['peris_unit_finished']=False;obj['peris_giant_head_fit']='Uniform rest geometry fit; static facial motion, existing head and neck bones'
 if source_arm.users==0:bpy.data.objects.remove(source_arm,do_unlink=True)
 # Fresh copied skin image prevents stale packed image bytes on native reopen.
 mat=body.data.materials[0].copy();mat.name='Peris giant weathered warm olive body matching adapted face';p=mat.node_tree.nodes.get('Principled BSDF')
 if p.inputs['Base Color'].links:
  node=p.inputs['Base Color'].links[0].from_node;old=node.image;pixels=np.empty(len(old.pixels),dtype=np.float32);old.pixels.foreach_get(pixels);pixels=pixels.reshape((old.size[1],old.size[0],4))
  pixels[:,:,:3]*=np.asarray((.88,.77,.65));node.image=_image('Peris giant coherent warm olive skin',pixels)
 p.inputs['Roughness'].default_value=.88;body.data.materials[0]=mat
 uv=stone.data.uv_layers.active
 if uv is None or any(not all(math.isfinite(c) for c in loop.uv) for loop in uv.data):raise ValueError('Existing spherical stone UV required')
 stone.data.materials.clear();stone.data.materials.append(_stone_material());stone['peris_stone_finish']='Original non-periodic layered granite mineral paint; spherical UV retained; exact stone geometry/release weights unchanged'
 arm['peris_licensed_head_credit']=json.dumps(credit);arm['peris_orc_face']='Adapted accepted detailed source face, enlarged uniformly for boulder giant; separate CC-BY4 head partition'
 record={'operation':'Detailed credited head and natural stone/body finish on unchanged planted throw rig','acceptedHeadNative':str(path),'acceptedHeadNativeSha256':source_hash,
         'removedOriginalFaceParts':old_face,'removedSupersededBodyHeadFaces':removed_faces,'licensedHeadParts':len(copied),'headUniformScale':1.06,
         'rigActionsRestBonesAndReleaseControlChanged':False,'stoneGeometryAndReleaseWeightsChanged':False,'handScope':'Retained source hand and carry socket; coarse digits remain a prototype limit',
         'runtimeApproved':False,'finishedUnitApproved':False}
 arm['peris_giant_refinement']=json.dumps(record);return record
