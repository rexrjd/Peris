import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=path.resolve(import.meta.dirname,'..'),nodes=JSON.parse(await fs.readFile(path.join(root,'src/features/research/domain/catalog.json'),'utf8'));
assert.equal(nodes.length,210);assert.equal(nodes.filter(t=>!t.faction).length,100);const ids=new Set(nodes.map(n=>n.id));assert.equal(ids.size,210);
const visited=new Set(),visiting=new Set();function visit(t){assert.ok(!visiting.has(t.id),'Prerequisite cycle');if(visited.has(t.id))return;visiting.add(t.id);for(const id of t.requires){assert.ok(ids.has(id),'Missing prerequisite');visit(nodes.find(n=>n.id===id));}visiting.delete(t.id);visited.add(t.id);}nodes.forEach(visit);
const hashes=new Set();for(const n of nodes){const bytes=await fs.readFile(path.join(root,'public/art/research/v1',n.id+'.webp')),m=await sharp(bytes).metadata();assert.ok(m.hasAlpha&&m.width===192&&m.height===192,n.id);hashes.add(createHash('sha256').update(bytes).digest('hex'));}
assert.equal(hashes.size,210,'Every technology has distinct artwork');
for(const f of ['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon']){assert.equal(nodes.filter(n=>n.faction===f).length,10);const m=await sharp(path.join(root,'public/art/city/academy-v1',f+'.webp')).metadata();assert.ok(m.hasAlpha&&m.width===384&&m.height===384);}
assert.ok((await sharp(path.join(root,'public/art/ui/low-poly-v1/research.webp')).metadata()).hasAlpha);
console.log('210 unique technology pictures, all Academy art and the catalog DAG verified');
