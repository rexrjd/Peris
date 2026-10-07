import * as THREE from 'three';
import { FACTIONS, type Faction } from '../../../factions/domain/factions';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Same stone, terracotta, timber and flat shading as the campaign models. */
export function cityKit(faction: Faction = 'roman') {
    const palette=FACTIONS[faction];
    const group = new THREE.Group();
    const material = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
    const m = {
        stone: material(0xc4bea5), light: material(0xd8d0b5), darkStone: material(0x8f9789),
        roof: material(0x995536), roofLight: material(0xb46a45), slate: material(0x5c7274),
        wood: material(0x65503b), timber: material(0x9c784e), dark: material(0x3c4036),
        road: material(0xc3ae80), green: material(0x547442), leaf: material(0x71884c),
        gold: material(0xcfa657), earth: material(0x8e8260), wheat: material(0xb8ac64), water: material(0x4c9299),
    };
    for(const key of Object.keys(palette) as (keyof typeof palette)[]) if(key in m) (m[key as keyof typeof m]).color.set(palette[key] as number);
    const shapes = {
        box: new THREE.BoxGeometry(1, 1, 1), cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
        cone: new THREE.ConeGeometry(1, 1, 6), dome:new THREE.SphereGeometry(1,12,6,0,Math.PI*2,0,Math.PI/2), rock: new THREE.IcosahedronGeometry(1, 0),
    };
    const roofShape = new THREE.BufferGeometry();
    roofShape.setAttribute('position', new THREE.Float32BufferAttribute([
        -.5,0,-.5, -.5,0,.5, 0,1,.5, -.5,0,-.5, 0,1,.5, 0,1,-.5,
        0,1,-.5, 0,1,.5, .5,0,.5, 0,1,-.5, .5,0,.5, .5,0,-.5,
        -.5,0,.5, .5,0,.5, 0,1,.5, -.5,0,-.5, 0,1,-.5, .5,0,-.5,
        -.5,0,-.5, .5,0,-.5, .5,0,.5, -.5,0,-.5, .5,0,.5, -.5,0,.5,
    ], 3));
    roofShape.computeVertexNormals();
    function mesh(shape: THREE.BufferGeometry, surface: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, angle = 0) {
        const object = new THREE.Mesh(shape, surface);
        object.position.set(x, y, z); object.scale.set(sx, sy, sz); object.rotation.y = angle;
        object.castShadow = true; object.receiveShadow = true; group.add(object); return object;
    }
    const box = (w: number, h: number, d: number, x: number, bottom: number, z: number, surface: THREE.Material, angle = 0) => mesh(shapes.box, surface, x, bottom + h / 2, z, w, h, d, angle);
    const cylinder = (r: number, h: number, x: number, bottom: number, z: number, surface: THREE.Material) => mesh(shapes.cylinder, surface, x, bottom + h / 2, z, r, h, r);
    const cone = (r: number, h: number, x: number, bottom: number, z: number, surface: THREE.Material) => mesh(shapes.cone, surface, x, bottom + h / 2, z, r, h, r);
    const rock = (r: number, x: number, bottom: number, z: number, surface:THREE.Material = m.darkStone) => mesh(shapes.rock, surface, x, bottom + r * .65, z, r, r * .9, r * .85, x * 2);
    const gable = (w: number, h: number, d: number, x: number, bottom: number, z: number, surface:THREE.Material = m.roof) => mesh(roofShape, surface, x, bottom, z, w, h, d);
    function roof(w:number,h:number,d:number,x:number,bottom:number,z:number,surface:THREE.Material=m.roof) {
        if(faction==='egyptian'||faction==='dwarf') {const cap=box(w,h*.25,d,x,bottom,z,surface);box(w*.87,h*.22,d*.87,x,bottom+h*.25,z,m.light);return cap;}
        if(faction==='persian'||faction==='gnome') {const dome=mesh(shapes.dome,surface,x,bottom,z,w*.52,h*1.5,d*.52);cylinder(Math.min(w,d)*.52,.06,x,bottom,z,surface);cylinder(.035,h*.4,x,bottom+h*1.5,z,m.gold);return dome;}
        if(faction==='elf') {const peak=cone(Math.min(w,d)*.65,h*2.1,x,bottom,z,surface);peak.scale.x=w*.6;peak.scale.z=d*.6;return peak;}
        if(faction==='orc') {const tent=cone(Math.max(w,d)*.66,h*1.65,x,bottom,z,surface);for(const side of [-1,1])cone(.09,h*.8,x+side*w*.35,bottom+h*.5,z,m.light);return tent;}
        if(faction==='pandaren') {const tier=gable(w,h*.6,d,x,bottom,z,surface);box(w*1.07,.06,d*1.07,x,bottom,z,m.gold);for(const side of [-1,1]){const tip=box(.22,.06,d*1.06,x+side*w*.49,bottom+.05,z,surface);tip.rotation.z=side*.4;}return tier;}
        const top=gable(w,h*(faction==='undead'?1.7:faction==='demon'?1.35:1),d,x,bottom,z,surface);
        if(faction==='demon')for(const side of [-1,1]){const horn=cone(.12,h*1.4,x+side*w*.36,bottom+h*.4,z,m.gold);horn.rotation.z=-side*.28;}
        return top;
    }
    function house(x: number, z: number, w: number, d: number, h: number, stone = false, tone = m.roof) {
        if(faction==='orc'||faction==='gnome') cylinder(Math.min(w,d)*.58,h,x,0,z,stone?m.stone:m.timber);
        else box(w, h, d, x, 0, z, stone || ['spartan','egyptian','dwarf','undead','demon'].includes(faction) ? m.light : m.timber);
        roof(w + .16, h * .43, d + .18, x, h, z, tone);
        box(w * .22, h * .57, .035, x, 0, z + d / 2 + .012, m.dark);
        for (const side of [-1, 1]) box(.13, .17, .04, x + side * w * .29, h * .56, z + d / 2 + .018, m.dark);
        if (!stone) for (const side of [-1, 1]) box(.065, h, .045, x + side * (w / 2 - .035), 0, z + d / 2 + .023, m.wood);
    }
    function tower(x: number, z: number, h: number, r = .3, pointed = false) {
        if(faction==='dwarf'||faction==='egyptian')box(r*2,h,r*2,x,0,z,m.stone);else cylinder(r,h,x,0,z,m.stone); cylinder(r*1.12,.13,x,h-.12,z,m.light);
        if(pointed||['elf','pandaren','orc','undead','demon','persian','gnome'].includes(faction)) roof(r*2.5,r*.85,r*2.5,x,h,z,m.slate);
        else for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI / 3;
            box(.17, .2, .15, x + Math.sin(angle) * r * .82, h, z + Math.cos(angle) * r * .82, m.light, angle);
        }
        box(.08, .24, .035, x, h * .62, z + r, m.dark);
    }
    function flag(x: number, bottom: number, z: number, h = .9) {
        cylinder(.025, h, x, bottom, z, m.wood);
        box(.36, .26, .025, x + .18, bottom + h - .3, z, m.roof);
        box(.05, .2, .035, x + .15, bottom + h - .27, z + .014, m.gold);
    }
    function fence(x: number, z: number, length: number, angle = 0) {
        const local = (dx: number) => [x + dx * Math.cos(angle), z - dx * Math.sin(angle)];
        for (let i = 0; i <= Math.ceil(length / .55); i++) {
            const p = local(-length / 2 + length * i / Math.ceil(length / .55));
            box(.065, .5, .065, p[0], 0, p[1], m.wood);
        }
        for (const bottom of [.15, .36]) box(length, .06, .06, x, bottom, z, m.timber, angle);
    }
    function heraldry(level:number,x=0,z=0) {
        if(!level)return;
        if(faction==='orc'||faction==='demon')for(const side of [-1,1]){const tusk=cone(.1,.4+level*.04,x+side*.48,.15,z+.7,m.light);tusk.rotation.z=-side*.3;}
        if(faction==='spartan'){const shield=cylinder(.2,.06,x,.3,z+.72,m.gold);shield.rotation.x=Math.PI/2;}
        if(faction==='egyptian'){box(.09,.7+level*.07,.09,x+.65,0,z+.65,m.gold);cone(.1,.2,x+.65,.7+level*.07,z+.65,m.slate);}
        if(faction==='gnome'){const gear=cylinder(.19,.055,x,.35,z+.7,m.gold);gear.rotation.x=Math.PI/2;for(let i=0;i<8;i++)box(.075,.075,.06,x+Math.sin(i*Math.PI/4)*.2,.35+Math.cos(i*Math.PI/4)*.2,z+.7,m.gold);}
        if(faction==='pandaren')for(const side of [-1,1]){cylinder(.025,.65,x+side*.48,0,z+.65,m.wood);rock(.11,x+side*.48,.45,z+.65,m.roofLight);}
        if(faction==='elf'||faction==='undead'){rock(.15,x,.2,z+.7,m.water);m.water.emissive.set(palette.water).multiplyScalar(.2);}
    }
    /** Merge by material so an upgraded district stays cheap to draw. */
    function finish() {
        group.updateMatrixWorld(true);
        const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
        group.traverse(object => {
            if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
            const shape = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
            shape.applyMatrix4(object.matrixWorld); shape.deleteAttribute('uv');
            const batch = batches.get(object.material) ?? []; batch.push(shape); batches.set(object.material, batch);
        });
        group.clear();
        for (const [surface, batch] of batches) {
            const shape = mergeGeometries(batch, false)!;
            const object = new THREE.Mesh(shape, surface); object.castShadow = true; object.receiveShadow = true;
            group.add(object); batch.forEach(item => item.dispose());
        }
        Object.values(shapes).forEach(shape => shape.dispose()); roofShape.dispose();
        Object.values(m).filter(surface => !batches.has(surface)).forEach(surface => surface.dispose());
        return group;
    }
    return { group, m, box, cylinder, cone, rock, roof, house, tower, flag, fence, heraldry, finish };
}

export function disposeCityObject(object: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    object.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        if(child instanceof THREE.InstancedMesh) child.dispose();
        geometries.add(child.geometry);
        for (const surface of Array.isArray(child.material) ? child.material : [child.material]) materials.add(surface);
    });
    geometries.forEach(shape => shape.dispose()); materials.forEach(surface => surface.dispose()); object.clear();
}
