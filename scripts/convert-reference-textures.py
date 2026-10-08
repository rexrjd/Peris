"""Losslessly decode the selected legacy DDS textures for Blender/glTF."""
import pathlib, json
from PIL import Image
root=pathlib.Path(__file__).resolve().parents[1]
art=root/'assets/references/units/0ad'
out=root/'assets/source/battle/reference-textures'
inventory=json.loads((art/'inventory.json').read_text())
count=0
for file in inventory['files']:
    relative=file['path']
    if not relative.lower().endswith('.dds'):continue
    destination=out/pathlib.Path(relative).with_suffix('.png')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with Image.open(art/relative) as image:image.convert('RGBA').save(destination)
    count+=1
print(f'Decoded {count} DDS textures without changing downloaded originals')
