"""Namespace runtime node names without touching binary geometry/animation.

This operates on a separate GLB file. Node indices, skin joints, children,
inverse binds, animation channel targets and every BIN byte remain unchanged.
"""
import pathlib,json,struct,hashlib,copy,argparse
ROLES=('line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry','ram','catapult')
def namespace_exported_glb_nodes(source,output):
 source=pathlib.Path(source);output=pathlib.Path(output)
 if source.resolve()==output.resolve():raise ValueError('Use a separate immutable namespace derivative')
 if output.exists():raise FileExistsError('Preserve existing export derivative: '+str(output))
 blob=source.read_bytes();magic,version,length=struct.unpack_from('<4sII',blob)
 if magic!=b'glTF' or version!=2 or length!=len(blob):raise ValueError('Expected valid GLB2 header')
 offset=12;chunks=[]
 while offset<len(blob):
  size,kind=struct.unpack_from('<II',blob,offset);data=blob[offset+8:offset+8+size]
  if len(data)!=size:raise ValueError('Truncated GLB chunk')
  chunks.append((kind,data));offset+=8+size
 if chunks[0][0]!=0x4e4f534a:raise ValueError('First chunk must be JSON')
 document=json.loads(chunks[0][1]);before=copy.deepcopy(document);nodes=document.get('nodes',[]);parents={child:i for i,n in enumerate(nodes) for child in n.get('children',[])};names=[]
 def role_for(index):
  seen=set()
  while index not in seen:
   seen.add(index);node=nodes[index];extra=node.get('extras',{});role=extra.get('peris_role')
   if role in ROLES:return role
   name=node.get('name','')
   for role in ROLES:
    if name.startswith(role):return role
   if index not in parents:break
   index=parents[index]
  return 'export'
 for index,node in enumerate(nodes):
  old=node.get('name','unnamed');suffix=''.join(c if c.isalnum() or c=='_' else '_' for c in old);new=role_for(index)+'_node'+str(index)+'__'+suffix;node['name']=new;names.append({'node':index,'sourceName':old,'runtimeName':new})
 stripped_before=copy.deepcopy(before);stripped_after=copy.deepcopy(document)
 for n in stripped_before.get('nodes',[]):n.pop('name',None)
 for n in stripped_after.get('nodes',[]):n.pop('name',None)
 if stripped_before!=stripped_after:raise ValueError('Non-name structural JSON changed')
 raw_json=json.dumps(document,separators=(',',':'),ensure_ascii=False).encode();raw_json+=b' '*((-len(raw_json))%4);new_chunks=[(chunks[0][0],raw_json)]+chunks[1:];size=12+sum(8+len(data) for kind,data in new_chunks);result=struct.pack('<4sII',b'glTF',2,size)+b''.join(struct.pack('<II',len(data),kind)+data for kind,data in new_chunks)
 bin_before=b''.join(data for kind,data in chunks if kind==0x004e4942);bin_after=b''.join(data for kind,data in new_chunks if kind==0x004e4942)
 if bin_before!=bin_after:raise ValueError('Binary geometry/animation changed')
 if len({n['name'] for n in nodes})!=len(nodes):raise ValueError('Runtime node names not unique')
 output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(result)
 sha=lambda data:hashlib.sha256(data).hexdigest()
 return {'method':'Separate GLB derivative: node.name strings only receive stable role/node-index prefixes. Numeric node identities, hierarchy, skins, animation channel targets and BIN bytes unchanged.','source':{'path':str(source),'sha256':sha(blob)},'output':{'path':str(output),'sha256':sha(result),'bytes':len(result)},'binarySha256Before':sha(bin_before),'binarySha256After':sha(bin_after),'binaryByteExact':bin_before==bin_after,'structuralJSONEqualExcludingNodeNames':stripped_before==stripped_after,'globallyUniqueRuntimeNodeNames':True,'nodesRenamed':len(names),'semanticSeparator':'__','nodeNames':names,'nativeFilesChanged':False}
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');p.add_argument('--report');a=p.parse_args();report=namespace_exported_glb_nodes(a.source,a.output)
 if a.report:pathlib.Path(a.report).write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k!='nodeNames'}))
