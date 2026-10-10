"""Isolate legacy COLLADA imports before assembling the shared scene."""
import bpy, pathlib, json, argparse, sys, xml.etree.ElementTree as ET
root=pathlib.Path(__file__).resolve().parents[2]
art=root/'assets/references/units/0ad'
cache=root/'assets/source/battle/reference-import-cache-v4'
cache.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--inventory',default='inventory.json')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if pathlib.Path(args.inventory).name!=args.inventory:raise ValueError('Inventory must be a filename in the reference folder')
inventory=json.loads((art/args.inventory).read_text())
def structure(node):
    return (node.tag,tuple(sorted(node.attrib.items())),(node.text or '').strip(),tuple(structure(child) for child in node))
for file in inventory['files']:
    name=file['path']
    if not name.endswith('.dae'):continue
    target=cache/(name.replace('/','_')+'.blend')
    if target.exists():continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    source=art/name;tree=ET.parse(source);ns={'c':'http://www.collada.org/2005/11/COLLADASchema'}
    duplicate_ids=[]
    for visual in tree.findall('.//c:visual_scene',ns):
        seen={}
        for node in list(visual):
            identity=node.get('id')
            if identity in seen:
                # Some old game files duplicate an entire joint tree with the
                # same COLLADA IDs. Keep the first definition, as ID references
                # do; sanitize an intermediate, never the downloaded original.
                if structure(node)!=structure(seen[identity]):raise ValueError('Conflicting COLLADA node ID: '+name+' '+identity)
                visual.remove(node);duplicate_ids.append(identity)
            else:seen[identity]=node
    if duplicate_ids:
        ET.register_namespace('',ns['c'])
        intermediate=cache/(name.replace('/','_')+'.clean.dae');tree.write(intermediate,encoding='utf-8',xml_declaration=True)
        source=intermediate
        print('DEDUPLICATED_COLLADA_IDS',name,duplicate_ids,flush=True)
    bpy.ops.wm.collada_import(filepath=str(source))
    bpy.ops.wm.save_as_mainfile(filepath=str(target))
    print('CACHED_REFERENCE',name,flush=True)
