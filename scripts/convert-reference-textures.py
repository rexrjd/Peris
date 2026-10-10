"""Losslessly decode the selected legacy DDS textures for Blender/glTF."""
import pathlib, json, argparse
from PIL import Image
root=pathlib.Path(__file__).resolve().parents[1]
art=root/'assets/references/units/0ad'
out=root/'assets/source/battle/reference-textures'
parser=argparse.ArgumentParser();parser.add_argument('--inventory',default='inventory.json')
args=parser.parse_args()
if pathlib.Path(args.inventory).name!=args.inventory:raise ValueError('Inventory must be a filename in the reference folder')
inventory=json.loads((art/args.inventory).read_text())
count=0
for file in inventory['files']:
    relative=file['path']
    if not relative.lower().endswith('.dds'):continue
    destination=out/pathlib.Path(relative).with_suffix('.png')
    destination.parent.mkdir(parents=True,exist_ok=True)
    with Image.open(art/relative) as image:image.convert('RGBA').save(destination)
    count+=1
print(f'Decoded {count} DDS textures without changing downloaded originals')
