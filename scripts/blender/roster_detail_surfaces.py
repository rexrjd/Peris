"""Deterministic original PBR grain, with exportable image-only shader graphs."""
import hashlib,math,bpy,numpy as np
from fantasy_portrait_quality import image

def detail_material(name,color,kind='metal',metal=.7,rough=.5,size=512):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes['Principled BSDF'];yy,xx=np.mgrid[:size,:size];rng=np.random.default_rng(int(hashlib.sha256(name.encode()).hexdigest()[:8],16));grain=rng.normal(0,.024,(size,size));broad=np.sin(xx*.021+np.sin(yy*.012)*2)*np.sin(yy*.023)
 if kind=='fur':h=.030*np.sin(xx*.83+np.sin(yy*.015)*6)+grain*.4;shade=.87+broad*.12+np.sin(xx*.83+yy*.13)*.08
 elif kind=='wool':h=.065*np.sin(xx*.14+np.sin(yy*.16)*2)*np.sin(yy*.13)+grain*.4;shade=.85+broad*.10+h*1.4
 elif kind=='cloth':h=.018*np.sin(xx*1.8)+.018*np.sin(yy*1.8)+grain*.3;shade=.91+broad*.06+grain
 elif kind=='horn':h=.035*np.sin(yy*.12+np.sin(xx*.016)*3)+grain*.2;shade=.85+h*2+broad*.11
 elif kind=='skin':h=grain*.3+.007*np.sin(yy*.28);shade=.86+broad*.13+grain
 else:h=.015*np.sin(xx*.17)*np.sin(yy*.13)+grain*.2;shade=.9+broad*.11+grain
 pixels=np.ones((size,size,4),np.float32);pixels[:,:,:3]=np.clip(np.asarray(color)*shade[:,:,None],0,1)
 def tex(label,pixels,nc=False):
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=image(name+' '+label,pixels,nc);return t
 t=tex('original color grain',pixels);m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color']);p.inputs['Metallic'].default_value=metal
 pixels=np.ones_like(pixels);pixels[:,:,:3]=np.clip(rough+broad[:,:,None]*.055+grain[:,:,None],.18,.98);t=tex('original roughness grain',pixels,True);m.node_tree.links.new(t.outputs['Color'],p.inputs['Roughness'])
 dy,dx=np.gradient(h);normal=np.stack((-dx*5,-dy*5,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2)[:,:,None];pixels=np.ones_like(pixels);pixels[:,:,:3]=normal*.5+.5;t=tex('original normal grain',pixels,True);n=m.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.55;m.node_tree.links.new(t.outputs['Color'],n.inputs['Color']);m.node_tree.links.new(n.outputs['Normal'],p.inputs['Normal']);return m

def gild_existing_metal(collection,prefix,color=(.64,.43,.12)):
 """Recolor only metallic atlas texels. Cloth, skin, UVs and relief stay intact."""
 materials={m for o in collection.all_objects if o.type=='MESH' for m in o.data.materials if m};records=[]
 for m in materials:
  if not m.use_nodes:continue
  p=m.node_tree.nodes.get('Principled BSDF')
  if not p or not p.inputs['Base Color'].is_linked:continue
  color_node=p.inputs['Base Color'].links[0].from_node
  if color_node.type!='TEX_IMAGE' or not color_node.image:continue
  metal=p.inputs['Metallic'];im=color_node.image;w,h=im.size
  rgb=np.empty(w*h*4,np.float32);im.pixels.foreach_get(rgb);rgb=rgb.reshape(h,w,4)
  if metal.is_linked:
   n=metal.links[0].from_node
   if n.type!='SEPARATE_COLOR' or not n.inputs['Color'].is_linked:continue
   t=n.inputs['Color'].links[0].from_node
   if t.type!='TEX_IMAGE' or not t.image or tuple(t.image.size)!=(w,h):continue
   orm=np.empty(w*h*4,np.float32);t.image.pixels.foreach_get(orm);orm=orm.reshape(h,w,4);mask=orm[:,:,2]>.36
  else:mask=np.full((h,w),metal.default_value>.36)
  if not np.any(mask):continue
  luminance=rgb[:,:,:3]@np.asarray((.2126,.7152,.0722));detail=np.clip(.68+luminance*1.55,.65,1.35)
  changed=rgb.copy();changed[mask,:3]=np.clip(detail[mask,None]*np.asarray(color),0,1)
  replacement=im.copy();replacement.name=prefix+' original gilded metal atlas';replacement.pixels.foreach_set(changed.ravel());replacement.pack();color_node.image=replacement
  records.append({'material':m.name,'metallicTexelsRecolored':int(mask.sum()),'nonMetalColorTexelsUnchanged':True,'normalRoughnessAndUVUnchanged':True})
 return records
