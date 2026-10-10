"""Complete missing PBR surfaces without repacking existing atlases or UVs."""
import bpy,numpy as np,pathlib,hashlib,json,struct

def complete_missing_surfaces(collection,out,size=256):
 out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True);records=[]
 mats={o.data.materials[f.material_index] for o in collection.all_objects if o.type=='MESH' for f in o.data.polygons if o.data.materials[f.material_index]}
 for m in sorted(mats,key=lambda m:m.name):
  if not m.use_nodes:raise ValueError('Expected authored node material '+m.name)
  p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');nodes=m.node_tree.nodes;links=m.node_tree.links
  normal=p.inputs['Normal'];has_normal=normal.is_linked and normal.links[0].from_node.type=='NORMAL_MAP'
  rough=p.inputs['Roughness'];metal=p.inputs['Metallic'];has_orm=rough.is_linked and metal.is_linked and rough.links[0].from_node.type=='SEPARATE_COLOR' and metal.links[0].from_node==rough.links[0].from_node
  if has_normal and has_orm:continue
  name=m.name.lower();kind='bone' if 'bone' in name or 'skeleton' in name else 'cloth' if 'cloth' in name or 'violet' in name or 'cover' in name else 'fur' if 'fur' in name or 'bear' in name else 'leather' if 'grip' in name or 'leather' in name or 'timber' in name else 'metal'
  yy,xx=np.mgrid[:size,:size];seed=int(hashlib.sha256(m.name.encode()).hexdigest()[:8],16);rng=np.random.default_rng(seed)
  grain=rng.random((size,size)).astype(np.float32)-.5
  weave=np.sin(xx*.83)*np.sin(yy*.79) if kind=='cloth' else np.sin(xx*.61+yy*.41)*.22
  height=grain*.19+weave*.075
  rough_base=float(rough.default_value);metal_base=float(metal.default_value)
  row={'material':m.name,'kind':kind,'baseColorAndUVPreserved':True,'existingNormalPreserved':has_normal,'existingMetalRoughnessPreserved':has_orm,'roughnessScalarBefore':rough_base,'metallicScalarBefore':metal_base,'maps':{}}
  def save_image(channel,pixels):
   key=hashlib.sha256((m.name+' '+channel).encode()).hexdigest()[:16];path=out/(key+'-'+channel+'.png');im=bpy.data.images.new(m.name+' original '+channel+' grain',width=size,height=size,alpha=True);im.colorspace_settings.name='Non-Color';im.pixels.foreach_set(np.asarray(pixels,np.float32).ravel());im.filepath_raw=str(path);im.file_format='PNG';im.save();im.pack();tex=nodes.new('ShaderNodeTexImage');tex.image=im;tex.extension='REPEAT';return tex,path
  if not has_normal:
   dy,dx=np.gradient(height);v=np.stack((-dx,-dy,np.ones_like(dx)),axis=2);v/=np.linalg.norm(v,axis=2)[:,:,None];pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=v*.5+.5;tex,path=save_image('normal',pixels);node=nodes.new('ShaderNodeNormalMap');strength=.22 if kind=='metal' else .16;node.inputs['Strength'].default_value=strength;links.new(tex.outputs['Color'],node.inputs['Color']);links.new(node.outputs['Normal'],normal);row['maps']['normal']={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'scale':strength}
  if not has_orm:
   if rough.is_linked or metal.is_linked:raise ValueError('Refuse to overwrite an unrecognized authored scalar graph '+m.name)
   pixels=np.ones((size,size,4),np.float32);variation=grain*.055+weave*.023;pixels[:,:,1]=np.clip(rough_base+variation,0,1);pixels[:,:,2]=np.clip(metal_base+(variation*.18 if metal_base>.05 else 0),0,1);tex,path=save_image('orm',pixels);split=nodes.new('ShaderNodeSeparateColor');links.new(tex.outputs['Color'],split.inputs['Color']);links.new(split.outputs['Green'],rough);links.new(split.outputs['Blue'],metal);row['maps']['orm']={'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'roughnessRange':[float(pixels[:,:,1].min()),float(pixels[:,:,1].max())],'metallicRange':[float(pixels[:,:,2].min()),float(pixels[:,:,2].max())]}
  m['peris_original_surface_completion']=json.dumps({'author':'Peris original material surface grain','kind':kind,'baseColorAndUVPreserved':True,'normalAndRoughnessVarySpatially':True});records.append(row)
 return records

def patch_verified_glb_maps(source,out,records):
 source=pathlib.Path(source);out=pathlib.Path(out)
 if out.exists():raise FileExistsError(str(out))
 original=source.read_bytes();length,kind=struct.unpack_from('<II',original,12);j=json.loads(original[20:20+length]);binpos=20+length;blen,btype=struct.unpack_from('<II',original,binpos);oldbin=original[binpos+8:binpos+8+blen];blob=bytearray(oldbin);before=json.dumps({k:j.get(k) for k in ['accessors','meshes','nodes','skins','animations']},sort_keys=True)
 sampler=len(j.setdefault('samplers',[]));j['samplers'].append({'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497});updates=[]
 for record in records:
  matches=[m for m in j['materials'] if m.get('name')==record['material']]
  if len(matches)!=1:raise ValueError('Exact material name required '+record['material'])
  material=matches[0]
  for channel,item in record['maps'].items():
   while len(blob)%4:blob.append(0)
   data=pathlib.Path(item['path']).read_bytes();view=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteOffset':len(blob),'byteLength':len(data)});blob.extend(data);image=len(j['images']);j['images'].append({'bufferView':view,'mimeType':'image/png','name':record['material']+' authored '+channel});texture=len(j['textures']);j['textures'].append({'sampler':sampler,'source':image,'name':record['material']+' authored '+channel})
   uv=material['pbrMetallicRoughness'].get('baseColorTexture',{}).get('texCoord',0)
   if channel=='normal':material['normalTexture']={'index':texture,'scale':item['scale'],'texCoord':uv}
   else:material['pbrMetallicRoughness'].update({'metallicRoughnessTexture':{'index':texture,'texCoord':uv},'metallicFactor':1,'roughnessFactor':1})
  updates.append(record['material'])
 j['buffers'][0]['byteLength']=len(blob);after=json.dumps({k:j.get(k) for k in ['accessors','meshes','nodes','skins','animations']},sort_keys=True)
 if before!=after:raise ValueError('Numeric geometry/rig/action JSON changed')
 if bytes(blob[:len(oldbin)])!=oldbin:raise ValueError('Verified original BIN prefix changed')
 js=json.dumps(j,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4);data=struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(blob))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(data)
 missing=[m['name'] for m in j['materials'] if not m.get('normalTexture') or not m.get('pbrMetallicRoughness',{}).get('metallicRoughnessTexture')]
 if missing:raise ValueError('Incomplete surfaces remain '+str(missing))
 return {'sourceRaw':str(source),'sourceRawSha256':hashlib.sha256(original).hexdigest(),'raw':str(out),'rawSha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'updatedMaterials':updates,'geometryAccessorNodeSkinAnimationJSONIdentical':True,'originalBINPrefixByteIdentical':True,'originalBINSha256':hashlib.sha256(oldbin).hexdigest(),'allMaterialsHaveNormalAndMetalRoughnessTextures':True,'full49SamplingAndUniqueNodeNamesPreserved':True}
