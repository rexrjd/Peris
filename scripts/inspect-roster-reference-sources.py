"""Record selected licensed appearance, rig and combat-clip sources for builders."""
import json, pathlib, xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[1]
ART=ROOT/'assets/references/units/0ad'
inventory=json.loads((ART/'inventory-roster-v3.json').read_text())

def appearance(path):
    result={'actor':path,'textures':{},'props':[],'animations':{}}
    def merge(node,animation_only=False):
        inherited=node.get('file')
        if inherited:merge(ET.parse(ART/'variants'/inherited).getroot(),animation_only)
        if not animation_only:
            mesh=node.find('mesh')
            if mesh is not None:result['mesh']=mesh.text.strip()
            for texture in node.findall('textures/texture'):
                result['textures'][texture.get('name')]=texture.get('file')
            result['props'].extend({'actor':p.get('actor'),'socket':p.get('attachpoint')} for p in node.findall('props/prop') if p.get('actor'))
        for animation in node.findall('animations/animation'):
            name=animation.get('name','').lower()
            if name in ['idle','walk','run','attack_melee','attack_ranged','attack']:
                result['animations'].setdefault(name,animation.get('file'))
        for group in node.findall('group'):
            choices=group.findall('variant')
            chosen=next((v for v in choices if v.get('name')=='rome-muscled-cuirass'),choices[0] if choices else None)
            if chosen is not None:merge(chosen,animation_only)
            for variant in choices:
                if variant is not chosen and ('attack_melee' in variant.get('file','') or 'attack_ranged' in variant.get('file','')):
                    merge(variant,True)
    root=ET.parse(ART/'actors'/path).getroot()
    merge(root.find('inline') if root.tag=='qualitylevels' else root)
    if 'mesh' in result:
        source=ET.parse(ART/'meshes'/result['mesh']).getroot()
        ns={'c':'http://www.collada.org/2005/11/COLLADASchema'}
        rig=source.find('.//c:controller/c:skin',ns)
        if rig is not None:
            joints=rig.find('c:joints/c:input[@semantic="JOINT"]',ns)
            names=rig.find('c:source[@id="'+joints.get('source').removeprefix('#')+'"]/c:Name_array',ns)
            if names is None:names=rig.find('c:source[@id="'+joints.get('source').removeprefix('#')+'"]/c:IDREF_array',ns)
            result['jointNames']=(names.text or '').split() if names is not None else []
        else:result['jointNames']=[]
    return result

families={family:[appearance(path) for path in actors] for family,actors in inventory['actorSeeds'].items()}
output={'edition':'roster-v3','revision':inventory['revision'],'license':inventory['license'],'author':inventory['author'],'authorUrl':inventory['authorUrl'],'licenseUrl':inventory['licenseUrl'],'inventory':'0ad/inventory-roster-v3.json','families':families,'notes':[
    'Each family uses one coherent appearance variant. Equipment remains modular and attached to authored rig sockets.',
    'Archer attacks are state variants, separate from Idle appearance choices. Normalize clip names to lowercase before lookup.',
    'Bear, boar, wolf, deer and elephant are source animals, with original Peris saddles/armor and rider fitting required for fantasy cavalry.',
    'An elephant can support an original mammoth adaptation; no proprietary Total War model has been downloaded.',
    'The onager has no walk source clip. A stationary visual study can explicitly reuse its idle clip for that state.',
    '0 A.D. legacy specular textures are not directly glTF metallic/roughness maps. Their interpretation belongs to the assembly/material pipeline.',
]}
destination=ROOT/'assets/references/units/roster-sources-v3.json'
destination.write_text(json.dumps(output,indent=2)+'\n')
for family,profiles in families.items():
    print(family,[(p['actor'],len(p.get('jointNames',[])),sorted(p['animations'])) for p in profiles])
